#!/usr/bin/env node
/**
 * P2 — Dừng stack `npm run dev` của CHÍNH repo này để build không bị khoá file.
 *
 * Chỉ tắt process thoả cả 3 điều kiện (xem scripts/lib/build-guard.mjs):
 *   1. cmdline chứa gốc dự án này
 *   2. khớp một marker dev (next dev, start-server, concurrently, dev-runner, electron dev, dev worker)
 *   3. KHÔNG thuộc app đã đóng gói (loại trừ \win-unpacked\, \resources\standalone\, app.asar)
 *
 * Nhờ vậy không bao giờ tắt nhầm app người dùng đang mở, kể cả khi họ chạy bản
 * đóng gói trong thư mục dist của dự án.
 *
 * Dùng: npm run stop:dev   |   node scripts/stop-dev.mjs --dry-run
 */
import {
  PROJECT_ROOT,
  rootNativeBinaryPath,
  checkNativeWritable,
  listNodeProcesses,
  findDevProcesses,
  killProcessTree,
} from './lib/build-guard.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const RELEASE_TIMEOUT_MS = 15_000;

function shortCmd(cmd, max = 120) {
  const oneLine = String(cmd || '').replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

function killAll(processes) {
  let killed = 0;
  for (const proc of processes) {
    const res = killProcessTree(proc.pid);
    if (res.ok) {
      killed++;
      console.log(`  ✓ đã tắt PID ${proc.pid} [${proc.label}]`);
    } else {
      // Process có thể đã chết theo cây của process khác — không coi là lỗi cứng.
      console.log(`  • PID ${proc.pid} [${proc.label}] không tắt được (có thể đã thoát): ${res.message}`);
    }
  }
  return killed;
}

function sleep(ms) {
  const { promise, resolve } = Promise.withResolvers();
  setTimeout(resolve, ms);
  return promise;
}

async function waitUntilWritable(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (checkNativeWritable(file).ok) return true;
    await sleep(400);
  }
  return checkNativeWritable(file).ok;
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('[stop:dev] Không phải Windows — không cần tắt vì hệ thống không khoá file theo cách này.');
    return 0;
  }

  const binding = rootNativeBinaryPath(PROJECT_ROOT);

  console.log(`[stop:dev] Gốc dự án: ${PROJECT_ROOT}`);
  console.log(`[stop:dev] Binding native: ${binding}`);
  console.log('');

  let processes = [];
  try {
    processes = listNodeProcesses();
  } catch (err) {
    console.error(`[stop:dev] ❌ Không liệt kê được process: ${err?.message || err}`);
    return 1;
  }

  const devProcesses = findDevProcesses(processes, PROJECT_ROOT);

  if (devProcesses.length === 0) {
    const state = checkNativeWritable(binding);
    console.log('[stop:dev] ✅ Không có process dev nào đang chạy.');
    console.log(state.ok
      ? '[stop:dev] ✅ Binding native ghi được — sẵn sàng build.'
      : `[stop:dev] ⚠️ Nhưng binding native vẫn bị khoá (${state.code}). Có tiến trình khác đang giữ file — xem \`npm run check:native-lock\`.`);
    return state.ok ? 0 : 1;
  }

  console.log(`[stop:dev] Tìm thấy ${devProcesses.length} process dev:`);
  for (const proc of devProcesses) {
    console.log(`  • PID ${proc.pid} [${proc.label}] ${shortCmd(proc.cmdline)}`);
  }
  console.log('');

  if (DRY_RUN) {
    console.log('[stop:dev] --dry-run: chỉ liệt kê, KHÔNG tắt process nào.');
    return 0;
  }

  const killed = killAll(devProcesses);
  console.log('');
  console.log(`[stop:dev] Đã gửi lệnh tắt ${killed}/${devProcesses.length} process.`);

  const released = await waitUntilWritable(binding, RELEASE_TIMEOUT_MS);
  if (!released) {
    console.error('[stop:dev] ❌ File native vẫn bị khoá sau khi tắt process dev.');
    console.error('[stop:dev]    Có thể một tiến trình khác đang giữ (editor, antivirus, terminal).');
    console.error('[stop:dev]    Kiểm tra chi tiết: npm run check:native-lock');
    return 1;
  }

  console.log('[stop:dev] ✅ Đã giải phóng file native — chạy được `npm run dist`.');
  return 0;
}

process.exit(await main());
