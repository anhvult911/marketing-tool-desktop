import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods to Renderer Process (UI)
contextBridge.exposeInMainWorld('electronAPI', {
  // App information & platform
  platform: process.platform,

  // Manual browser launcher (for captcha/OTP bypass)
  openManualBrowser: (accountId: number) => ipcRenderer.invoke('browser:open-manual', accountId),

  // Open external links
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),

  // Native Toast Notifications
  notify: (title: string, body: string) => ipcRenderer.invoke('app:notify', { title, body }),

  // ── Cập nhật phiên bản ──
  // Một nguồn sự thật duy nhất: main process giữ state, renderer chỉ hiển thị.
  updateGetState: () => ipcRenderer.invoke('update:get-state'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  updateOpenDownload: () => ipcRenderer.invoke('update:open-download'),
  onUpdateState: (callback: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on('update:state', listener);
    return () => ipcRenderer.removeListener('update:state', listener);
  },

  // Thoát ứng dụng (dùng cho popup bắt buộc cập nhật — thoát vẫn tự cài bản mới)
  quitApp: () => ipcRenderer.invoke('app:quit'),
});
