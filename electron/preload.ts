import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods to Renderer Process (UI)
contextBridge.exposeInMainWorld('electronAPI', {
  // App information & platform
  platform: process.platform,
  
  // Manual browser launcher (for captcha/OTP bypass)
  openManualBrowser: (accountId: number) => ipcRenderer.invoke('browser:open-manual', accountId),
  
  // Open external links
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  
  // Auto-updater events
  onUpdateAvailable: (callback: (info: any) => void) => {
    ipcRenderer.on('update:available', (_event, info) => callback(info));
  },
  onUpdateProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on('update:progress', (_event, progress) => callback(progress));
  },
  onUpdateDownloaded: (callback: (info: any) => void) => {
    ipcRenderer.on('update:downloaded', (_event, info) => callback(info));
  },
});
