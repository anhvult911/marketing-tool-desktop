#!/usr/bin/env node
/**
 * P3b — Bảo đảm node_modules gốc ở ABI NODE trước khi chạy dev.
 *
 * `npm run build:next` kết thúc bằng `@electron/rebuild` → binding native của
 * better-sqlite3 chuyển sang ABI Electron (132). Node 24 cần ABI 137, nên nếu
 * chạy `npm run dev` ngay sau khi build, app sẽ chết với "NODE_MODULE_VERSION
 * mismatch". Trước đây phải nhớ chạy tay `npm run rebuild:dev`.
 *
 * Script này kiểm tra bằng PHÉP THỬ CHỨC NĂNG (mở DB thật) và CHỈ rebuild khi
 * cần — tránh việc rebuild vô ích mỗi lần khởi động dev.
 *
 * Dùng như npm "pre" hook: "predev": "node scripts/ensure-node-abi.mjs"
 */
import { execFileSync } from 'node:child_process';
import {
  PROJECT_ROOT,
  rootNativeBinaryPath,
  packageDirFor,
  probeRuntime,
} from './lib/build-guard.mjs';

function main() {
  const binding = rootNativeBinaryPath(PROJECT_ROOT);
  const packageDir = packageDirFor(binding);

  const before = probeRuntime(process.execPath, packageDir, {});
  if (before.ok) {
    console.log('[ensure-node-abi] ✅ Binding native khớp ABI Node — không cần rebuild.');
    return 0;
  }

  console.log('[ensure-node-abi] ⚠️ Binding native không nạp được dưới Node.');
  console.log(`[ensure-node-abi]    Lý do: ${String(before.detail).slice(0, 140)}`);
  console.log('[ensure-node-abi] 🔧 Đang chạy `npm rebuild better-sqlite3` (cần mạng hoặc cache prebuild)...');

  let rebuildOk = true;
  try {
    // stdio inherit: để người dùng thấy tiến trình tải prebuild.
    execFileSync('npm', ['rebuild', 'better-sqlite3'], {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      shell: true,
      windowsHide: true,
    });
  } catch {
    rebuildOk = false;
  }

  const after = probeRuntime(process.execPath, packageDir, {});
  if (after.ok) {
    console.log('[ensure-node-abi] ✅ Đã khôi phục binding native cho Node — `npm run dev` chạy được.');
    return 0;
  }

  console.error('');
  console.error('[ensure-node-abi] ❌ Vẫn không nạp được binding native sau khi rebuild.');
  console.error(`[ensure-node-abi]    Chi tiết: ${String(after.detail).slice(0, 160)}`);
  if (!rebuildOk) {
    console.error('[ensure-node-abi]    `npm rebuild` thất bại — thường do không có mạng để tải prebuild,');
    console.error('[ensure-node-abi]    hoặc file native đang bị process khác giữ (chạy `npm run check:native-lock`).');
  }
  console.error('[ensure-node-abi]    Kiểm tra thêm: npm run check:native-lock   |   npm run rebuild:dev');
  return 1;
}

process.exit(main());
