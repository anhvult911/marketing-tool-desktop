/**
 * Cầu nối có type tới `window.electronAPI` (do electron/preload.ts phơi ra).
 * Renderer chạy trong Electron thì có, chạy trên trình duyệt (dev) thì không —
 * mọi hàm ở đây đều phải chịu được trường hợp `null`.
 */

export type UpdateStatus =
  | 'idle' | 'checking' | 'available' | 'downloading'
  | 'downloaded' | 'up-to-date' | 'error' | 'unsupported';

export interface UpdatePolicy {
  minimumVersion: string;
  recommendedVersion: string;
  message: string;
}

export interface UpdateState {
  currentVersion: string;
  latestVersion: string | null;
  status: UpdateStatus;
  level: 'none' | 'recommended' | 'required';
  policy: UpdatePolicy;
  policySource: 'network' | 'cache' | 'default';
  message: string;
  reason: string;
  downloadPercent: number;
  lastCheckedAt: number | null;
  error: string | null;
  releaseUrl: string;
  forceDisabled: boolean;
  supported: boolean;
}

export interface ElectronAPI {
  platform: string;
  openManualBrowser: (accountId: number) => Promise<unknown>;
  openExternal: (url: string) => Promise<unknown>;
  notify: (title: string, body: string) => Promise<unknown>;
  updateGetState: () => Promise<UpdateState>;
  updateCheck: () => Promise<UpdateState>;
  updateInstall: () => Promise<boolean>;
  updateOpenDownload: () => Promise<boolean>;
  onUpdateState: (callback: (state: UpdateState) => void) => () => void;
  quitApp: () => Promise<boolean>;
}

/** Trả về API nếu đang chạy trong Electron, ngược lại null. */
export function getElectronAPI(): ElectronAPI | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;
  return api ?? null;
}
