import path from 'path';
import fs from 'fs';

function getBaseUserDataDir(): string {
  if (process.env.MKT_USER_DATA_DIR) {
    return process.env.MKT_USER_DATA_DIR;
  }

  const isProd = process.env.NODE_ENV === 'production';
  if (isProd) {
    const base = process.env.APPDATA 
      || (process.platform === 'darwin' ? path.join(process.env.HOME || '', 'Library', 'Application Support') : '/var/local');
    return path.join(base, 'marketing-tool-desktop');
  }

  // Trong môi trường development, dùng thư mục project để tiện debug
  return process.cwd();
}

export const USER_DATA_DIR = getBaseUserDataDir();

export const PROFILES_DIR = process.env.NODE_ENV === 'production'
  ? path.join(USER_DATA_DIR, 'profiles')
  : path.join(process.cwd(), 'profiles');

export const UPLOADS_DIR = process.env.NODE_ENV === 'production'
  ? path.join(USER_DATA_DIR, 'uploads')
  : path.join(process.cwd(), 'public', 'uploads');

export const DB_DIR = process.env.NODE_ENV === 'production'
  ? USER_DATA_DIR
  : path.join(process.cwd(), 'data');

export const DB_PATH = path.join(DB_DIR, 'mkt.db');
export const LOGS_DIR = path.join(USER_DATA_DIR, 'logs');

// Đảm bảo tất cả thư mục cần thiết luôn tồn tại
export function ensureAppDirectories() {
  [USER_DATA_DIR, PROFILES_DIR, UPLOADS_DIR, DB_DIR, LOGS_DIR].forEach((dir) => {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (e: any) {
      console.warn(`[Paths] Không thể tạo thư mục ${dir}:`, e.message);
    }
  });
}

ensureAppDirectories();
