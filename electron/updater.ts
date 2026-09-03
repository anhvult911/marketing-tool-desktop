import { autoUpdater } from 'electron-updater';
import { dialog, BrowserWindow, app, ipcMain } from 'electron';

function isVersionLower(current: string, target: string): boolean {
  try {
    const p1 = current.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    const p2 = target.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
      const n1 = p1[i] || 0;
      const n2 = p2[i] || 0;
      if (n1 < n2) return true;
      if (n1 > n2) return false;
    }
    return false;
  } catch {
    return false;
  }
}

export function setupAutoUpdater(mainWindow: BrowserWindow) {
  // Only check updates in production builds
  if (process.env.NODE_ENV === 'development') {
    return;
  }

  const currentVersion = app.getVersion();
  const minRequiredVersion = process.env.MIN_SUPPORTED_VERSION || '1.0.0';

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`[AutoUpdater] Update available: ${info.version}`);
    
    // Check if this update is critical/mandatory (Force Update)
    const isForceUpdate = isVersionLower(currentVersion, minRequiredVersion);
    mainWindow.webContents.send('update:available', { ...info, isForceUpdate });

    if (isForceUpdate) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Bắt buộc cập nhật phiên bản mới',
        message: `Phiên bản hiện tại (${currentVersion}) không còn tương thích với cấu trúc CSDL chung.\n\nHệ thống đang tự động tải phiên bản mới (v${info.version}). Ứng dụng sẽ tự khởi động lại sau khi hoàn tất.`,
        buttons: ['Đang tải cập nhật...'],
      });
    }
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[AutoUpdater] Application is up to date.');
  });

  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater] Error during update:', err.message);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    console.log(`[AutoUpdater] Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent.toFixed(2)}%`);
    mainWindow.webContents.send('update:progress', progressObj);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[AutoUpdater] Update downloaded: ${info.version}`);
    mainWindow.webContents.send('update:downloaded', info);

    const isForceUpdate = isVersionLower(currentVersion, minRequiredVersion);

    if (isForceUpdate) {
      // Force immediate restart and install
      autoUpdater.quitAndInstall();
    } else {
      // Soft update prompt
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Cập nhật phiên bản mới',
        message: `Đã tải về phiên bản mới (v${info.version}). Bạn có muốn khởi động lại ứng dụng để áp dụng tính năng mới ngay?`,
        buttons: ['Khởi động lại ngay', 'Để sau'],
        defaultId: 0,
        cancelId: 1
      }).then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
    }
  });

  // Check on startup
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('[AutoUpdater] Failed initial check:', err);
  });

  // Periodic check every 2 hours
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error('[AutoUpdater] Failed periodic check:', err);
    });
  }, 2 * 60 * 60 * 1000);
}

