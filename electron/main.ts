import { app, BrowserWindow, ipcMain, shell, utilityProcess, UtilityProcess, Tray, Menu, MenuItem, nativeImage, Notification } from 'electron';
import { fork, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import http from 'http';
import net from 'net';
import { initAppDirectories, PROFILES_DIR, LOGS_DIR } from './paths';
import { setupAutoUpdater } from './updater';
import { chromium } from 'playwright';

// Đảm bảo chỉ 1 phiên bản duy nhất của ứng dụng được chạy
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
}

const APP_ID = 'com.mkttools.desktop';
const APP_NAME = 'MKT Tools Desktop';
app.setName(APP_NAME);
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID);
}

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Khởi tạo thư mục trước để ghi log bền vững
initAppDirectories();
const LOGS_FILE = path.join(LOGS_DIR, 'app.log');

export function appLog(msg: string, ...args: any[]) {
  const timestamp = new Date().toISOString();
  const text = args.length > 0
    ? `${msg} ${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ')}`
    : msg;
  const line = `[${timestamp}] ${text}\n`;
  try {
    process.stdout.write(line);
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.appendFileSync(LOGS_FILE, line);
  } catch {}
}

process.on('uncaughtException', (err) => {
  appLog(`[CRITICAL UNCAUGHT EXCEPTION] ${err.stack || err.message}`);
});
process.on('unhandledRejection', (reason: any) => {
  appLog(`[CRITICAL UNHANDLED REJECTION] ${reason?.stack || reason}`);
});

// Hardware Acceleration & Chromium GPU Flags for 60-120 FPS buttery-smooth rendering
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,CanvasOopRasterization,SmoothScrolling');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let serverProcess: UtilityProcess | null = null;
let workerProcess: UtilityProcess | ChildProcess | null = null;

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
        path.join(process.cwd(), 'build/icon.png'),
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

function startBackgroundWorker(): UtilityProcess | ChildProcess | null {
  const possiblePaths = isDev
    ? [
        path.join(app.getAppPath(), 'dist-worker/worker/worker.js'),
        path.join(__dirname, '../dist-worker/worker/worker.js'),
      ]
    : [
        path.join(process.resourcesPath, 'standalone', 'dist-worker', 'worker', 'worker.js'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-worker', 'worker', 'worker.js'),
        path.join(__dirname, '../dist-worker/worker/worker.js'),
        path.join(app.getAppPath(), 'dist-worker/worker/worker.js'),
      ];
  const workerPath = possiblePaths.find((p) => fs.existsSync(p));
  if (!workerPath) {
    appLog('[Main] ⚠️ Không tìm thấy file compiled worker tại:', possiblePaths);
    return null;
  }

  const standaloneModules = path.join(process.resourcesPath, 'standalone', 'node_modules');
  const nodePath = !isDev && fs.existsSync(standaloneModules)
    ? standaloneModules
    : path.join(app.getAppPath(), 'node_modules');

  appLog('[Main] 🚀 Khởi chạy Background Worker:', workerPath);
  try {
    let worker: any = null;
    if (isDev) {
      // Trong Electron, child_process.fork mặc định chạy electron.exe (NODE_MODULE_VERSION 132).
      // Để khớp với better-sqlite3 do Next.js / npm rebuild (NODE_MODULE_VERSION 137),
      // bắt buộc phải chỉ định execPath: 'node' để chạy bằng Node.js hệ thống.
      worker = fork(workerPath, [], {
        cwd: app.getAppPath(),
        stdio: 'pipe',
        execPath: 'node',
        env: {
          ...process.env,
          NODE_PATH: nodePath,
          NODE_ENV: 'development',
        },
      });
    } else {
      // Trong môi trường production, standalone server & worker dùng better-sqlite3 build cho Electron ABI
      worker = utilityProcess.fork(workerPath, [], {
        serviceName: 'mkt-worker',
        cwd: path.dirname(workerPath),
        stdio: 'pipe',
        env: {
          ...process.env,
          NODE_PATH: nodePath,
          NODE_ENV: 'production',
        },
      });
    }

    worker.stdout?.on('data', (d: any) => {
      const str = d.toString().trim();
      if (str) appLog(`[Worker] ${str}`);
    });

    worker.stderr?.on('data', (d: any) => {
      const str = d.toString().trim();
      if (str) appLog(`[Worker ERR] ${str}`);
    });

    worker.on('spawn', () => {
      appLog('[Main] ✅ Background Worker đã khởi chạy thành công.');
    });

    worker.on('message', (msg: any) => {
      if (msg && msg.type === 'notify') {
        showNotification(msg.title, msg.body);
      }
    });

    worker.on('exit', (code: any) => {
      appLog(`[Main] ⚠️ Background Worker đã dừng với mã: ${code}`);
      workerProcess = null;
      if (!isQuitting) {
        appLog('[Main] 🔄 Tự động phục hồi & khởi chạy lại Background Worker sau 3 giây...');
        setTimeout(() => {
          if (!isQuitting && !workerProcess) {
            workerProcess = startBackgroundWorker();
          }
        }, 3000);
      }
    });

    return worker;
  } catch (err: any) {
    appLog('[Main] ❌ Lỗi khi khởi chạy Background Worker:', err.message);
    return null;
  }
}

function startStandaloneServer(port: number): UtilityProcess | null {
  const possiblePaths = [
    path.join(process.resourcesPath, 'standalone', 'server.js'),
    path.join(process.resourcesPath, 'app.asar.unpacked', '.next', 'standalone', 'server.js'),
    path.join(__dirname, '../.next/standalone/server.js'),
    path.join(app.getAppPath(), '.next/standalone/server.js'),
  ];
  const serverPath = possiblePaths.find((p) => fs.existsSync(p));
  if (!serverPath) {
    appLog('[Main] ❌ Không tìm thấy standalone server tại:', possiblePaths);
    return null;
  }

  const standaloneModules = path.join(process.resourcesPath, 'standalone', 'node_modules');
  const nodePath = fs.existsSync(standaloneModules)
    ? standaloneModules
    : path.join(__dirname, '../node_modules');

  appLog(`[Main] 🚀 Khởi chạy Next.js Standalone Server trên port ${port}... Đường dẫn: ${serverPath}`);
  try {
    const server = utilityProcess.fork(serverPath, [], {
      serviceName: 'next-server',
      stdio: 'pipe',
      cwd: path.dirname(serverPath),
      env: {
        ...process.env,
        NODE_PATH: nodePath,
        PORT: String(port),
        HOSTNAME: '127.0.0.1',
        NODE_ENV: 'production',
      },
    });

    server.stdout?.on('data', (d) => {
      const str = d.toString().trim();
      if (str) appLog(`[Server] ${str}`);
    });

    server.stderr?.on('data', (d) => {
      const str = d.toString().trim();
      if (str) appLog(`[Server ERR] ${str}`);
    });

    server.on('spawn', () => {
      appLog(`[Main] ✅ Next.js Standalone Server đã khởi chạy thành công.`);
    });

    server.on('message', (msg: any) => {
      if (msg && msg.type === 'notify') {
        showNotification(msg.title, msg.body);
      }
    });

    server.on('exit', (code) => {
      appLog(`[Main] ⚠️ Next.js Server đã dừng với mã: ${code}`);
      serverProcess = null;
      if (!isQuitting) {
        appLog('[Main] 🔄 Tự động phục hồi & khởi chạy lại Next.js Server sau 2 giây...');
        setTimeout(async () => {
          if (!isQuitting && !serverProcess) {
            serverProcess = startStandaloneServer(port);
            await waitForServer(port);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.loadURL(`http://127.0.0.1:${port}`);
            }
          }
        }, 2000);
      }
    });

    return server;
  } catch (err: any) {
    appLog('[Main] ❌ Lỗi khi khởi chạy Next.js Server:', err.message);
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
    show: false, // Prevents white flash and stutter
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false, // Maintains fluid 60 FPS even when not focused
      spellcheck: false, // Disables heavy background spellchecker thread
    },
    autoHideMenuBar: true,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  let appUrl = 'http://127.0.0.1:3000';

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

  // Enable F12 to toggle DevTools anytime for inspection
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      mainWindow?.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // External link handler with protocol whitelist (ngăn chặn RCE qua custom protocol)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(url);
      } else {
        console.warn(`[Security Alert] Chặn mở giao thức URL nguy hiểm: ${parsed.protocol}`);
      }
    } catch {}
    return { action: 'deny' };
  });

  // Native Right-Click Context Menu (Cut, Copy, Paste, Select All)
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu();

    if (params.isEditable) {
      menu.append(new MenuItem({ role: 'undo', label: 'Hoàn tác (Undo)' }));
      menu.append(new MenuItem({ role: 'redo', label: 'Làm lại (Redo)' }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ role: 'cut', label: 'Cắt (Cut)' }));
      menu.append(new MenuItem({ role: 'copy', label: 'Sao chép (Copy)' }));
      menu.append(new MenuItem({ role: 'paste', label: 'Dán (Paste)' }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ role: 'selectAll', label: 'Chọn tất cả' }));
    } else if (params.selectionText && params.selectionText.trim().length > 0) {
      menu.append(new MenuItem({ role: 'copy', label: 'Sao chép (Copy)' }));
      menu.append(new MenuItem({ role: 'selectAll', label: 'Chọn tất cả' }));
    }

    if (menu.items.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
      menu.popup({ window: mainWindow });
    }
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

app.whenReady().then(async () => {
  appLog('[Main] 🚀 Ứng dụng MKT Tools Desktop đang khởi động...');
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
    const safeAccountId = parseInt(String(accountId), 10);
    if (isNaN(safeAccountId) || safeAccountId <= 0) {
      return { success: false, error: 'ID tài khoản không hợp lệ.' };
    }

    const profilePath = path.join(PROFILES_DIR, `account_${safeAccountId}`);
    let context: any;
    try {
      context = await chromium.launchPersistentContext(profilePath, {
        headless: false,
        viewport: null,
        args: ['--start-maximized'],
      });
    } catch (e: any) {
      try {
        context = await chromium.launchPersistentContext(profilePath, {
          headless: false,
          viewport: null,
          channel: 'msedge',
          args: ['--start-maximized'],
        });
      } catch {
        context = await chromium.launchPersistentContext(profilePath, {
          headless: false,
          viewport: null,
          channel: 'chrome',
          args: ['--start-maximized'],
        });
      }
    }

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
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      await shell.openExternal(url);
    }
  } catch {}
});

// IPC Handler: Bắn thông báo Windows Native Toast Notification
ipcMain.handle('app:notify', (_event, { title, body }: { title: string; body: string }) => {
  showNotification(title, body);
  return { success: true };
});
