import { getElectronAPI } from './electron-api';

/**
 * Gửi thông báo hệ điều hành (Windows Toast Notification)
 * Tương thích linh hoạt trong cả Electron Utility Process (Worker, Standalone Server) và giao diện Renderer
 */
export function sendDesktopNotification(title: string, body: string) {
  try {
    // 1. Utility Process trong Electron (Worker hoặc Next.js standalone)
    if (typeof process !== 'undefined' && (process as NodeJS.Process & { parentPort?: { postMessage: (msg: unknown) => void } }).parentPort) {
      (process as NodeJS.Process & { parentPort: { postMessage: (msg: unknown) => void } }).parentPort.postMessage({ type: 'notify', title, body });
      return;
    }

    // 1b. Node.js Child Process fork (môi trường dev)
    if (typeof process !== 'undefined' && typeof (process as NodeJS.Process & { send?: (msg: unknown) => void }).send === 'function') {
      (process as NodeJS.Process & { send: (msg: unknown) => void }).send({ type: 'notify', title, body });
      return;
    }

    // 2. Renderer Process (giao diện Next.js chạy trong BrowserWindow)
    const api = getElectronAPI();
    if (api) {
      api.notify(title, body);
      return;
    }

    // Fallback console log khi dev
    console.log(`[Desktop Notification] 📢 ${title} - ${body}`);
  } catch (err: unknown) {
    console.warn('[Notification Error]:', err instanceof Error ? err.message : err);
  }
}

export default sendDesktopNotification;
