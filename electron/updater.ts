/**
 * AUTO-UPDATE — chính sách phiên bản + luồng tải/cài.
 *
 * Kiến trúc (chuẩn cho app desktop không có server riêng):
 *   electron-updater đọc `latest.yml` từ GitHub Release để biết & tải bản mới;
 *   `update-policy.json` (asset của release) quyết định ai BỊ BUỘC cập nhật.
 *   App đẩy toàn bộ trạng thái xuống renderer qua 1 kênh `update:state`; renderer
 *   chỉ hiển thị, không tự quyết định (một nguồn sự thật duy nhất ở main process).
 *
 * Khác biệt so với bản cũ:
 *   - `MIN_SUPPORTED_VERSION` qua env là code chết (app đóng gói không nhận env) →
 *     thay bằng policy tải từ release, có cache đĩa để ép được cả khi offline.
 *   - Không còn 3 kênh IPC rời rạc mà renderer không hề đăng ký; giờ là 1 snapshot.
 *   - Ép buộc: KHÔNG tự quitAndInstall im lặng; renderer mở popup chặn, người dùng
 *     bấm cập nhật (hoặc thoát — thoát vẫn cài do autoInstallOnAppQuit).
 */
import { autoUpdater } from 'electron-updater';
import { dialog, BrowserWindow, app, ipcMain, net, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import {
  UpdatePolicy, UpdateLevel, DEFAULT_POLICY,
  parsePolicy, evaluatePolicy, POLICY_URL, RELEASE_PAGE_URL,
} from './update-policy';

export type UpdateStatus =
  | 'idle' | 'checking' | 'available' | 'downloading'
  | 'downloaded' | 'up-to-date' | 'error' | 'unsupported';

export interface UpdateState {
  currentVersion: string;
  latestVersion: string | null;
  status: UpdateStatus;
  /** Mức ép buộc theo policy: none | recommended | required */
  level: UpdateLevel;
  policy: UpdatePolicy;
  policySource: 'network' | 'cache' | 'default';
  /** Thông điệp hiển thị: policy.message, nếu trống thì dùng lý do suy ra */
  message: string;
  reason: string;
  downloadPercent: number;
  lastCheckedAt: number | null;
  error: string | null;
  releaseUrl: string;
  /** Chế độ hỗ trợ: biến môi trường MKT_DISABLE_FORCE_UPDATE=1 */
  forceDisabled: boolean;
  supported: boolean;
}

const CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000;
const POLICY_TIMEOUT_MS = 10_000;

let mainWindowRef: BrowserWindow | null = null;
let policy: UpdatePolicy = DEFAULT_POLICY;
let policySource: UpdateState['policySource'] = 'default';
let latestVersion: string | null = null;
let status: UpdateStatus = 'idle';
let downloadPercent = 0;
let lastCheckedAt: number | null = null;
let lastError: string | null = null;

const forceDisabled = process.env.MKT_DISABLE_FORCE_UPDATE === '1';

function policyCachePath(): string {
  return path.join(app.getPath('userData'), 'update-policy.json');
}

function currentVersion(): string {
  return app.getVersion();
}

function buildState(): UpdateState {
  const evaluation = forceDisabled
    ? { level: 'none' as UpdateLevel, reason: '' }
    : evaluatePolicy(currentVersion(), policy);

  return {
    currentVersion: currentVersion(),
    latestVersion,
    status,
    level: evaluation.level,
    policy,
    policySource,
    message: policy.message || evaluation.reason,
    reason: evaluation.reason,
    downloadPercent: Math.round(downloadPercent),
    lastCheckedAt,
    error: lastError,
    releaseUrl: RELEASE_PAGE_URL,
    forceDisabled,
    supported: app.isPackaged && process.env.NODE_ENV !== 'development',
  };
}

function broadcast(): void {
  const win = mainWindowRef;
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send('update:state', buildState());
  } catch (err: unknown) {
    console.warn('[AutoUpdater] Không gửi được state:', err instanceof Error ? err.message : err);
  }
}

/** Nạp policy từ cache đĩa (dùng khi mạng lỗi) — file hỏng thì bỏ qua. */
function loadCachedPolicy(): UpdatePolicy | null {
  try {
    const p = policyCachePath();
    if (!fs.existsSync(p)) return null;
    return parsePolicy(JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch {
    return null;
  }
}

function writeCachedPolicy(next: UpdatePolicy): void {
  try {
    fs.mkdirSync(path.dirname(policyCachePath()), { recursive: true });
    fs.writeFileSync(policyCachePath(), JSON.stringify(next, null, 2), 'utf8');
  } catch (err: unknown) {
    console.warn('[AutoUpdater] Không ghi được cache policy:', err instanceof Error ? err.message : err);
  }
}

/**
 * Tải policy từ release asset. Lỗi mạng KHÔNG được khoá người dùng: giữ policy
 * cũ (cache) và ghi nhận nguồn để UI giải thích.
 */
async function refreshPolicy(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POLICY_TIMEOUT_MS);
  try {
    const res = await net.fetch(POLICY_URL, {
      signal: controller.signal,
      // Yêu cầu revalidate thay vì dùng bản cache: policy có thể được cập nhật cho
      // cùng một release (upload đè asset) khi cần ép cập nhật gấp.
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parsePolicy(await res.json());
    if (!parsed) throw new Error('policy không hợp lệ');
    policy = parsed;
    policySource = 'network';
    writeCachedPolicy(parsed);
    console.log(`[AutoUpdater] Policy mới: min=${parsed.minimumVersion} recommended=${parsed.recommendedVersion}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const cached = loadCachedPolicy();
    if (cached) {
      policy = cached;
      policySource = 'cache';
      console.warn(`[AutoUpdater] Không tải được policy (${msg}) — dùng cache.`);
    } else {
      policy = DEFAULT_POLICY;
      policySource = 'default';
      console.warn(`[AutoUpdater] Không tải được policy (${msg}) và chưa có cache — không ép cập nhật.`);
    }
  } finally {
    clearTimeout(timer);
    broadcast();
  }
}

async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged || process.env.NODE_ENV === 'development') {
    status = 'unsupported';
    broadcast();
    return;
  }
  status = 'checking';
  lastError = null;
  broadcast();
  try {
    await autoUpdater.checkForUpdates();
    lastCheckedAt = Date.now();
  } catch (err: unknown) {
    status = 'error';
    lastError = err instanceof Error ? err.message : String(err);
    console.error('[AutoUpdater] Kiểm tra thất bại:', lastError);
  }
  broadcast();
}

function registerIpc(): void {
  ipcMain.handle('update:get-state', () => buildState());

  ipcMain.handle('update:check', async () => {
    await refreshPolicy();
    await checkForUpdates();
    return buildState();
  });

  ipcMain.handle('update:install', () => {
    console.log('[AutoUpdater] Người dùng yêu cầu cài bản mới — thoát và cập nhật.');
    // setImmediate: để IPC kịp trả về trước khi app thoát
    setImmediate(() => autoUpdater.quitAndInstall());
    return true;
  });

  ipcMain.handle('update:open-download', async () => {
    await shell.openExternal(RELEASE_PAGE_URL);
    return true;
  });

  ipcMain.handle('app:quit', () => {
    app.quit();
    return true;
  });
}

function wireAutoUpdaterEvents(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    status = 'checking';
    broadcast();
  });

  autoUpdater.on('update-available', (info) => {
    latestVersion = info.version;
    status = 'available';
    downloadPercent = 0;
    console.log(`[AutoUpdater] Có bản mới: v${info.version} (hiện tại v${currentVersion()})`);
    broadcast();
  });

  autoUpdater.on('update-not-available', (info) => {
    latestVersion = info?.version ?? latestVersion;
    status = 'up-to-date';
    lastCheckedAt = Date.now();
    broadcast();
  });

  autoUpdater.on('download-progress', (progress) => {
    status = 'downloading';
    downloadPercent = progress?.percent ?? 0;
    broadcast();
  });

  autoUpdater.on('update-downloaded', (info) => {
    latestVersion = info.version;
    status = 'downloaded';
    downloadPercent = 100;
    console.log(`[AutoUpdater] Đã tải xong v${info.version}.`);
    broadcast();

    // Bắt buộc: đóng hộp thoại cảnh báo để người dùng biết phải làm gì. Việc cài
    // do renderer kích hoạt (update:install) hoặc tự cài khi thoát app.
    const state = buildState();
    if (state.level === 'required' && !forceDisabled) {
      const options = {
        type: 'warning' as const,
        title: 'Bắt buộc cập nhật',
        message: `Bản ${currentVersion()} không còn được hỗ trợ.`,
        detail: 'Bản cập nhật đã tải xong. Bấm "Cập nhật ngay" để khởi động lại và áp dụng — hoặc đóng ứng dụng, bản mới sẽ tự cài.',
        buttons: ['Cập nhật ngay', 'Để sau'],
        defaultId: 0,
        cancelId: 1,
      };
      const box = mainWindowRef && !mainWindowRef.isDestroyed()
        ? dialog.showMessageBox(mainWindowRef, options)
        : dialog.showMessageBox(options);
      box.then((r) => {
        if (r.response === 0) autoUpdater.quitAndInstall();
      }).catch(() => {});
    }
  });

  autoUpdater.on('error', (err) => {
    status = 'error';
    lastError = err?.message || String(err);
    console.error('[AutoUpdater] Lỗi:', lastError);
    broadcast();
  });
}

export function setupAutoUpdater(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow;

  registerIpc();
  wireAutoUpdaterEvents();

  // Vẫn cho renderer xem version ở bản dev (chỉ không kiểm tra mạng).
  if (!app.isPackaged || process.env.NODE_ENV === 'development') {
    status = 'unsupported';
    console.log('[AutoUpdater] Bản dev/chưa đóng gói — chỉ hiển thị version, không kiểm tra cập nhật.');
    broadcast();
    return;
  }

  if (forceDisabled) {
    console.warn('[AutoUpdater] ⚠️ MKT_DISABLE_FORCE_UPDATE=1 — chế độ hỗ trợ, bỏ qua ép buộc cập nhật.');
  }

  // Trì hoãn nhẹ để cửa sổ render xong trước khi bắn state đầu tiên.
  setTimeout(() => {
    void refreshPolicy();
    void checkForUpdates();
  }, 4000);

  setInterval(() => {
    void refreshPolicy();
    void checkForUpdates();
  }, CHECK_INTERVAL_MS);
}
