import { app } from 'electron';
import path from 'path';
import fs from 'fs';

// Get AppData path (e.g. C:\Users\<Username>\AppData\Roaming\marketing-tool-desktop)
export const USER_DATA_PATH = app.isReady() 
  ? app.getPath('userData') 
  : path.join(process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : '/var/local'), 'marketing-tool-desktop');

export const DB_PATH = path.join(USER_DATA_PATH, 'mkt.db');
export const PROFILES_DIR = path.join(USER_DATA_PATH, 'profiles');
export const UPLOADS_DIR = path.join(USER_DATA_PATH, 'uploads');
export const LOGS_DIR = path.join(USER_DATA_PATH, 'logs');

// Ensure necessary directories exist
export function initAppDirectories() {
  [USER_DATA_PATH, PROFILES_DIR, UPLOADS_DIR, LOGS_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}
