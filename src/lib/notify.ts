/**
 * Gửi thông báo hệ điều hành (Windows Toast Notification)
 * Tương thích linh hoạt trong cả Electron Utility Process (Worker, Standalone Server) và giao diện Renderer
 */
export function sendDesktopNotification(title: string, body: string) {
  try {
    // 1. Utility Process trong Electron (Worker hoặc Next.js standalone)
    if (typeof process !== 'undefined' && (process as any).parentPort) {
      (process as any).parentPort.postMessage({ type: 'notify', title, body });
      return;
    }

    // 2. Renderer Process (giao diện Next.js chạy trong BrowserWindow)
    if (typeof window !== 'undefined' && (window as any).electronAPI?.notify) {
      (window as any).electronAPI.notify(title, body);
      return;
    }

    // Fallback console log khi dev
    console.log(`[Desktop Notification] 📢 ${title} - ${body}`);
  } catch (err: any) {
    console.warn('[Notification Error]:', err.message);
  }
}

export default sendDesktopNotification;
