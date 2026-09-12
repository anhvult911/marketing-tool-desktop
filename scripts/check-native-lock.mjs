#!/usr/bin/env node
/**
 * P1 — GUARD trước `npm run build:next`.
 *
 * `npm run build:next` bắt đầu bằng `npm rebuild better-sqlite3`, lệnh này cần
 * GHI ĐÈ binding native. Trên Windows, nếu stack `npm run dev` đang chạy thì file
 * đang bị map vào bộ nhớ → prebuild-install báo EBUSY và node-gyp báo EPERM.
 *
 * Guard này phát hiện TRƯỚC khi npm rebuild chạy được nửa chừng, và chỉ đích danh
 * process đang giữ file để người dùng xử lý (hoặc chạy `npm run stop:dev`).
 *
 * Dùng như npm "pre" hook: "prebuild:next": "node scripts/check-native-lock.mjs"
 */
import {
  PROJECT_ROOT,
  rootNativeBinaryPath,
  checkNativeWritable,
  findModuleHolders,
} from './lib/build-guard.mjs';

function shortCmd(cmd, max = 130) {
  const oneLine = String(cmd || '').replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

function main() {
  if (process.platform !== 'win32') {
    console.log('[build-guard] Không phải Windows — bỏ qua kiểm tra khoá file native.');
    return 0;
  }

  const binding = rootNativeBinaryPath(PROJECT_ROOT);
  const check = checkNativeWritable(binding);

  if (check.ok) {
    console.log(
      check.missing
        ? `[build-guard] ✅ Chưa có binding native (bản cài mới) — npm rebuild sẽ tạo mới.`
        : `[build-guard] ✅ Binding native ghi được: ${binding}`
    );
    return 0;
  }

  console.error('');
  console.error('[build-guard] ❌ Không ghi được binding native — build sẽ thất bại ngay ở bước npm rebuild.');
  console.error(`  File : ${binding}`);
  console.error(`  Lỗi  : ${check.code} — ${check.message}`);
  console.error('');

  let holders = [];
  try {
    holders = findModuleHolders();
  } catch (err) {
    console.error(`  (không liệt kê được process đang giữ file: ${err?.message || err})`);
  }

  if (holders.length > 0) {
    console.error('  Process đang giữ file (phải tắt trước khi build):');
    for (const h of holders) {
      console.error(`    • PID ${h.pid} [${h.name}] ${shortCmd(h.cmdline)}`);
    }
  } else {
    console.error('  Không tìm thấy process node/electron nào đang map file này.');
    console.error('  Có thể một tiến trình khác (antivirus, editor, terminal) đang giữ — thử đóng bớt rồi chạy lại.');
  }

  console.error('');
  console.error('  Cách xử lý:');
  console.error('    1) Dừng stack dev:  npm run stop:dev');
  console.error('    2) Hoặc Ctrl+C terminal đang chạy `npm run dev` rồi chạy lại `npm run dist`.');
  console.error('  Lưu ý: app ĐÃ CÀI không giữ file này (dùng bản sao trong %LOCALAPPDATA%), không cần tắt app.');
  console.error('');
  return 1;
}

process.exit(main());
