#!/usr/bin/env node
/**
 * P3a — VERIFY ABI sau khi build: bảo đảm artifact đóng gói nạp được binding native.
 *
 * Vì sao cần: better-sqlite3 là module native, binding phải khớp ABI của runtime
 * (Electron 34 = ABI 132, Node 24 = ABI 137). Nếu copy nhầm bản, `npm run dist`
 * vẫn thành công nhưng app cài xong sẽ crash ngay khi mở DB — lỗi chỉ lộ ra ở
 * người dùng. Bước này biến nó thành lỗi build.
 *
 * Kiểm tra bằng PHÉP THỬ CHỨC NĂNG (mở DB, ghi, đọc) chứ không chỉ `require`:
 * require có thể thành công rồi mới ném lỗi lúc dùng.
 *
 * Dùng: node scripts/verify-native-abi.mjs   (chạy cuối build:next)
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  PROJECT_ROOT,
  rootNativeBinaryPath,
  standaloneNativeBinaryPath,
  packageDirFor,
  probeRuntime,
  electronBinaryPath,
} from './lib/build-guard.mjs';

let fail = 0;
function report(label, ok, detail) {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label} → ${detail}`);
    fail++;
  }
}

function main() {
  if (process.platform !== 'win32') {
    console.log('[verify-abi] Chỉ chạy kiểm tra ABI trên Windows — bỏ qua.');
    return 0;
  }

  const electron = electronBinaryPath(PROJECT_ROOT);
  if (!fs.existsSync(electron)) {
    console.error(`[verify-abi] ❌ Không tìm thấy Electron: ${electron}`);
    console.error('[verify-abi]    Chạy `npm ci` trước khi build.');
    return 1;
  }
  // ELECTRON_RUN_AS_NODE: chạy electron như node thuần để nạp binding và mở DB.
  const electronEnv = { ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ATTACH_CONSOLE: '1' };

  console.log(`[verify-abi] Electron: ${electron}`);
  console.log('');

  const packagedDir = packageDirFor(standaloneNativeBinaryPath(PROJECT_ROOT));
  const rootDir = packageDirFor(rootNativeBinaryPath(PROJECT_ROOT));

  console.log('— Artifact sẽ được đóng gói (phải chạy được dưới Electron) —');
  const packagedBinding = standaloneNativeBinaryPath(PROJECT_ROOT);
  if (!fs.existsSync(packagedBinding)) {
    report('binding standalone tồn tại', false,
      `thiếu ${packagedBinding} — bước @electron/rebuild hoặc copy-assets.js chưa chạy xong`);
  } else {
    const res = probeRuntime(electron, packagedDir, electronEnv);
    report('standalone binding nạp + ghi/đọc DB dưới Electron', res.ok, res.detail);
  }

  console.log('— node_modules gốc (dùng cho next dev/build) —');
  if (!fs.existsSync(rootNativeBinaryPath(PROJECT_ROOT))) {
    report('binding gốc tồn tại', false, rootNativeBinaryPath(PROJECT_ROOT));
  } else {
    const res = probeRuntime(electron, rootDir, electronEnv);
    // Sau build:next, gốc ĐƯỢC PHÉP ở ABI Electron (electron-builder dùng nó để
    // đóng gói). Chỉ báo thông tin để người dùng biết `npm run dev` sẽ khôi phục.
    if (res.ok) {
      console.log('  ℹ️  Gốc đang ở ABI Electron (bình thường sau build:next).');
      console.log('      `npm run dev` sẽ tự khôi phục ABI Node qua predev hook.');
    } else {
      console.log(`  ℹ️  Gốc không nạp được dưới Electron (${res.detail.slice(0, 80)}).`);
      console.log('      Nếu bước trên ✅ thì artifact vẫn ổn; lệch này thường do rebuild gốc thất bại.');
    }
  }

  console.log('');
  if (fail > 0) {
    console.error(`[verify-abi] ❌ ${fail} kiểm tra thất bại — KHÔNG nên đóng gói bản này.`);
    console.error('[verify-abi]    Thường gặp: copy-assets.js chạy trước @electron/rebuild, hoặc rebuild thất bại nhưng bị bỏ qua.');
    return 1;
  }
  console.log('[verify-abi] ✅ Artifact đóng gói nạp được binding native — an toàn để chạy electron-builder.');
  return 0;
}

process.exit(main());
