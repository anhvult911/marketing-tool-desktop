import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

/**
 * Quản lý khóa profile trình duyệt (lockfile Singleton) và tự phục hồi profile
 * sau khi Chrome/Edge tự cập nhật major version (crashpad "Settings version is not 1",
 * exit code 21 trước khi bắt tay CDP).
 */

const LOCK_FILES = ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'lockfile'];

/**
 * Xóa lockfile của profile (không đụng tiến trình). Trả về số lockfile đã gỡ.
 */
export function unlockProfileDir(userDataDir: string): number {
  try {
    // turbopackIgnore: userDataDir là thư mục profile trình duyệt lúc chạy (ngoài bundle).
    // Không đánh dấu, bộ trace của Next sẽ glob cả project theo pattern
    // `<dynamic>/SingletonLock`, `.../lockfile` → over-bundling.
    if (!userDataDir || !fs.existsSync(/*turbopackIgnore: true*/ userDataDir)) return 0;
    let removed = 0;
    for (const lf of LOCK_FILES) {
      const lockPath = path.join(/*turbopackIgnore: true*/ userDataDir, lf);
      if (fs.existsSync(/*turbopackIgnore: true*/ lockPath)) {
        try {
          fs.unlinkSync(/*turbopackIgnore: true*/ lockPath);
          removed++;
        } catch {
          // File đang bị lock bởi tiến trình khác
        }
      }
    }
    return removed;
  } catch {
    return 0;
  }
}

/**
 * Tắt các tiến trình Chrome/Edge đang giữ profile (theo tên thư mục profile),
 * rồi gỡ lại lockfile. An toàn command injection: chỉ truyền tên thư mục đã sanitize.
 */
export function killProfileProcesses(userDataDir: string): void {
  try {
    if (!userDataDir || !fs.existsSync(/*turbopackIgnore: true*/ userDataDir)) return;
    const rawDirName = path.basename(userDataDir);
    // Sanitize nghiêm ngặt chỉ cho phép ký tự an toàn
    const profileDirName = rawDirName.replace(/[^a-zA-Z0-9_\-\.]/g, '');
    if (!profileDirName) return;

    const removed = unlockProfileDir(userDataDir);
    if (removed === 0) return; // Không có lockfile nào -> không có tiến trình chiếm profile

    if (process.platform === 'win32') {
      try {
        const psCommand = `Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe' or Name = 'msedge.exe'" | Where-Object { $_.CommandLine -like "*${profileDirName}*" } | Invoke-CimMethod -MethodName Terminate`;
        spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCommand], {
          stdio: 'ignore',
          timeout: 2500,
          windowsHide: true,
        });
      } catch {}
    } else {
      try {
        spawnSync('pkill', ['-9', '-f', profileDirName], { stdio: 'ignore', timeout: 2000 });
      } catch {}
    }

    // Dọn dẹp lại lockfiles sau khi tắt tiến trình
    unlockProfileDir(userDataDir);
  } catch {
    // Non-fatal
  }
}

/**
 * Tự phục hồi profile sau khi trình duyệt tự cập nhật major version:
 * - Gỡ lockfile + tắt tiến trình giữ profile
 * - Xóa Crashpad/settings.dat (crashpad từ chối format cũ: "Settings version is not 1")
 * Idempotent, non-fatal. Chrome/Edge tự tạo lại settings.dat hợp lệ ở lần chạy sau.
 */
export function repairProfileForLaunch(userDataDir: string): void {
  try {
    if (!userDataDir || !fs.existsSync(/*turbopackIgnore: true*/ userDataDir)) return;
    killProfileProcesses(userDataDir);
    const crashpadSettings = path.join(/*turbopackIgnore: true*/ userDataDir, 'Crashpad', 'settings.dat');
    if (fs.existsSync(/*turbopackIgnore: true*/ crashpadSettings)) {
      try { fs.rmSync(/*turbopackIgnore: true*/ crashpadSettings, { force: true }); } catch {}
    }
  } catch {
    // Non-fatal
  }
}

/**
 * Có nên thử repair + retry launch không? Chỉ với lỗi "browser đóng ngay khi mở"
 * (crash lúc khởi động), không retry với lỗi cấu hình/thiếu executable.
 */
export function isStartupCrashError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  if (!msg) return false;
  return (
    msg.includes('Target page, context or browser has been closed') ||
    msg.includes('Process failed to launch') ||
    msg.includes('Browser closed unexpectedly')
  );
}
