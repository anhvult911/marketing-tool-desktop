import { app, BrowserWindow, ipcMain, shell, utilityProcess, UtilityProcess, Tray, Menu, nativeImage, Notification } from 'electron';
import path from 'path';
import fs from 'fs';
import http from 'http';
import net from 'net';
import { initAppDirectories, PROFILES_DIR } from './paths';
import { setupAutoUpdater } from './updater';
import { chromium } from 'playwright';

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let serverProcess: UtilityProcess | null = null;
let workerProcess: UtilityProcess | null = null;

function getAvailablePort(defaultPort: number = 3000): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(defaultPort, '127.0.0.1', () => {
      server.close(() => resolve(defaultPort));
    });
    server.on('error', () => {
      const randomServer = net.createServer();
      randomServer.listen(0, '127.0.0.1', () => {
        const port = (randomServer.address() as net.AddressInfo).port;
        randomServer.close(() => resolve(port));
      });
    });
  });
}

function waitForServer(port: number, timeoutMs: number = 25000): Promise<boolean> {
  const startTime = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}`, (res) => {
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() - startTime > timeoutMs) {
          resolve(false);
        } else {
          setTimeout(check, 500);
        }
      });
    };
    check();
  });
}

function showNotification(title: string, body: string) {
  try {
    if (Notification.isSupported()) {
      const iconPaths = [
        path.join(__dirname, '../build/icon.png'),
        path.join(app.getAppPath(), 'build/icon.png'),
      ];
      const iconPath = iconPaths.find((p) => fs.existsSync(p));
      const notification = new Notification({
        title: title || 'MKT Tools Desktop',
        body: body || '',
        icon: iconPath,
      });
      notification.show();
      notification.on('click', () => {
        if (mainWindow) {
          if (!mainWindow.isVisible()) mainWindow.show();
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
      });
    }
  } catch (err: any) {
    console.warn('[Main] Không thể hiển thị thông báo:', err.message);
  }
}

function startBackgroundWorker(): UtilityProcess | null {
  const possiblePaths = [
    path.join(__dirname, '../dist-worker/worker/worker.js'),
    path.join(app.getAppPath(), 'dist-worker/worker/worker.js'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-worker', 'worker', 'worker.js'),
  ];
  const workerPath = possiblePaths.find((p) => fs.existsSync(p));
  if (!workerPath) {
    console.warn('[Main] ⚠️ Không tìm thấy file compiled worker tại:', possiblePaths);
    return null;
  }

  console.log('[Main] 🚀 Khởi chạy Background Worker:', workerPath);
  try {
    const worker = utilityProcess.fork(workerPath, [], {
      serviceName: 'mkt-worker',
      env: { ...process.env, NODE_ENV: isDev ? 'development' : 'production' },
    });

    worker.on('spawn', () => {
      console.log('[Main] ✅ Background Worker đã khởi chạy thành công.');
    });

    worker.on('message', (msg: any) => {
      if (msg && msg.type === 'notify') {
        showNotification(msg.title, msg.body);
      }
    });

    worker.on('exit', (code) => {
      console.log(`[Main] ⚠️ Background Worker đã dừng với mã: ${code}`);
    });

    return worker;
  } catch (err: any) {
    console.error('[Main] Lỗi khi khởi chạy Background Worker:', err.message);
    return null;
  }
}

function startStandaloneServer(port: number): UtilityProcess | null {
  const possiblePaths = [
    path.join(__dirname, '../.next/standalone/server.js'),
    path.join(app.getAppPath(), '.next/standalone/server.js'),
    path.join(process.resourcesPath, 'app.asar.unpacked', '.next', 'standalone', 'server.js'),
  ];
  const serverPath = possiblePaths.find((p) => fs.existsSync(p));
  if (!serverPath) {
    console.error('[Main] ❌ Không tìm thấy standalone server tại:', possiblePaths);
    return null;
  }

  console.log(`[Main] 🚀 Khởi chạy Next.js Standalone Server trên port ${port}...`);
  try {
    const server = utilityProcess.fork(serverPath, [], {
      serviceName: 'next-server',
      env: {
        ...process.env,
        PORT: String(port),
        HOSTNAME: '127.0.0.1',
        NODE_ENV: 'production',
      },
    });

    server.on('spawn', () => {
      console.log(`[Main] ✅ Next.js Standalone Server đã khởi chạy.`);
    });

    server.on('message', (msg: any) => {
      if (msg && msg.type === 'notify') {
        showNotification(msg.title, msg.body);
      }
    });

    server.on('exit', (code) => {
      console.log(`[Main] ⚠️ Next.js Server đã dừng với mã: ${code}`);
    });

    return server;
  } catch (err: any) {
    console.error('[Main] Lỗi khi khởi chạy Next.js Server:', err.message);
    return null;
  }
}

function createTray() {
  const trayIconPaths = [
    path.join(__dirname, '../build/tray.png'),
    path.join(app.getAppPath(), 'build/tray.png'),
    path.join(__dirname, '../public/tray.png'),
    path.join(app.getAppPath(), 'public/tray.png'),
  ];
  const trayPath = trayIconPaths.find((p) => fs.existsSync(p));
  const icon = trayPath ? nativeImage.createFromPath(trayPath) : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('MKT Tools Desktop - Tự Động Hóa Marketing');

  const updateContextMenu = () => {
    const loginSettings = app.getLoginItemSettings();
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Mở MKT Tools Desktop',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      { type: 'separator' },
      {
        label: `Tiến trình Worker: ${workerProcess ? 'Đang chạy ngầm ✅' : 'Đã dừng ⏹️'}`,
        enabled: false,
      },
      {
        label: 'Khởi động cùng Windows',
        type: 'checkbox',
        checked: loginSettings.openAtLogin,
        click: (menuItem) => {
          app.setLoginItemSettings({ openAtLogin: menuItem.checked });
        },
      },
      { type: 'separator' },
      {
        label: 'Thoát hoàn toàn',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray?.setContextMenu(contextMenu);
  };

  updateContextMenu();

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

async function createWindow() {
  const appIconPaths = [
    path.join(__dirname, '../build/icon.png'),
    path.join(app.getAppPath(), 'build/icon.png'),
  ];
  const appIconPath = appIconPaths.find((p) => fs.existsSync(p));
  const winIcon = appIconPath ? nativeImage.createFromPath(appIconPath) : undefined;

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'MKT Tools Desktop',
    icon: winIcon,
    backgroundColor: '#0F172A',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
  });

  let appUrl = 'http://localhost:3000';

  if (!isDev) {
    const port = await getAvailablePort(3000);
    serverProcess = startStandaloneServer(port);

    const isReady = await waitForServer(port);
    if (isReady) {
      appUrl = `http://127.0.0.1:${port}`;
    } else {
      console.error('[Main] Server không phản hồi trong thời gian chờ.');
    }
  }

  mainWindow.loadURL(appUrl);

  // Auto-retry reload if Next.js dev server is compiling or temporarily restarting
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    if (isDev && (errorCode === -102 || errorDescription.includes('CONNECTION_REFUSED'))) {
      console.log(`[Main] Next.js dev server đang khởi động lại hoặc chưa sẵn sàng (${errorDescription}). Tự động kết nối lại sau 1.5s...`);
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(validatedURL || appUrl);
        }
      }, 1500);
    }
  });

  // External link handler
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Chặn thoát app khi bấm nút [X] -> Ẩn xuống khay System Tray để Worker tiếp tục chạy
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Setup auto-updater
  setupAutoUpdater(mainWindow);
}

// Ensure single app instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    initAppDirectories();

    // Khởi tạo khay hệ thống (System Tray)
    createTray();

    // Khởi chạy background worker
    workerProcess = startBackgroundWorker();

    await createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      } else if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  });
}

// Dọn dẹp tiến trình ngầm khi thoát hoàn toàn
app.on('before-quit', () => {
  isQuitting = true;
  if (tray) {
    try {
      tray.destroy();
    } catch {}
    tray = null;
  }
  if (workerProcess) {
    console.log('[Main] Đang dừng Background Worker...');
    try {
      workerProcess.kill();
    } catch {}
    workerProcess = null;
  }
  if (serverProcess) {
    console.log('[Main] Đang dừng Next.js Server...');
    try {
      serverProcess.kill();
    } catch {}
    serverProcess = null;
  }
});

app.on('window-all-closed', () => {
  // Không thoát app khi người dùng tắt cửa sổ trên Windows để worker tiếp tục chạy ngầm trong tray
});

// IPC Handler: Mở trình duyệt Chromium thật để người dùng tự tay giải Captcha/OTP
ipcMain.handle('browser:open-manual', async (_event, accountId: number) => {
  try {
    const profilePath = path.join(PROFILES_DIR, `account_${accountId}`);
    const context = await chromium.launchPersistentContext(profilePath, {
      headless: false,
      viewport: null,
      args: ['--start-maximized'],
    });

    const page = context.pages()[0] || (await context.newPage());
    await page.goto('https://x.com/login');
    return { success: true };
  } catch (err: any) {
    console.error('Lỗi khi mở trình duyệt thủ công:', err);
    return { success: false, error: err.message };
  }
});

// IPC Handler: Mở liên kết ngoài trình duyệt mặc định
ipcMain.handle('shell:open-external', async (_event, url: string) => {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    await shell.openExternal(url);
  }
});

// IPC Handler: Bắn thông báo Windows Native Toast Notification
ipcMain.handle('app:notify', (_event, { title, body }: { title: string; body: string }) => {
  showNotification(title, body);
  return { success: true };
});
