'use client';

import { useCallback, useEffect, useState } from 'react';
import { getElectronAPI, UpdateState } from '@/lib/electron-api';

/**
 * UI CẬP NHẬT PHIÊN BẢN.
 *
 * - `UpdateToast`: banner góc phải khi có bản mới (khuyến nghị / đang tải / đã tải).
 * - `ForceUpdateModal`: popup CHẶN khi policy yêu cầu (bản hiện tại dưới mức tối
 *   thiểu) — buộc cập nhật hoặc thoát (thoát vẫn tự cài do autoInstallOnAppQuit).
 * - `VersionPanel`: khối "Phiên bản & cập nhật" để nhúng vào cài đặt.
 *
 * Mọi thứ chỉ HIỂN THỊ state do main process đẩy xuống; quyết định nằm ở
 * electron/updater.ts (một nguồn sự thật).
 */

const STATUS_LABEL: Record<UpdateState['status'], string> = {
  idle: 'Chưa kiểm tra',
  checking: 'Đang kiểm tra...',
  available: 'Có bản mới',
  downloading: 'Đang tải về',
  downloaded: 'Đã tải xong',
  'up-to-date': 'Đang dùng bản mới nhất',
  error: 'Lỗi kiểm tra',
  unsupported: 'Không hỗ trợ trong bản này',
};

export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;
    let alive = true;

    // Lấy snapshot trước (event có thể đã bắn trước khi component mount)
    api.updateGetState()
      .then(s => { if (alive) setState(s); })
      .catch(() => {});

    const unsubscribe = api.onUpdateState(s => { if (alive) setState(s); });
    return () => { alive = false; if (typeof unsubscribe === 'function') unsubscribe(); };
  }, []);

  return state;
}

function formatCheckedAt(ts: number | null): string {
  if (!ts) return 'chưa kiểm tra';
  try {
    return new Date(ts).toLocaleString('vi-VN', { hour12: false });
  } catch {
    return 'không rõ';
  }
}

/** Banner cập nhật — tự ẩn khi không có gì để báo. */
export function UpdateToast() {
  const state = useUpdateState();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setDismissed(false); }, [state?.latestVersion, state?.status]);

  if (!state || !state.supported) return null;
  // Bắt buộc thì để popup chặn lo, không hiện banner trùng
  if (state.level === 'required' && !state.forceDisabled) return null;

  const relevant = state.status === 'available' || state.status === 'downloading' || state.status === 'downloaded';
  if (!relevant || dismissed) return null;

  const isDownloaded = state.status === 'downloaded';
  const target = state.latestVersion ? `v${state.latestVersion}` : 'mới';

  const install = async () => {
    const api = getElectronAPI();
    if (!api) return;
    setBusy(true);
    try { await api.updateInstall(); } finally { setBusy(false); }
  };

  return (
    <div style={{
      position: 'fixed', right: '1rem', bottom: '1rem', zIndex: 8000,
      width: 'min(360px, calc(100vw - 2rem))',
      backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--color-primary-hover)',
      borderRadius: '10px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', padding: '0.85rem 1rem',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
        <strong style={{ fontSize: '0.88rem', color: 'var(--color-primary-hover)' }}>
          🚀 Có bản cập nhật {target}
        </strong>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          title="Để sau"
          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}
        >✕</button>
      </div>

      <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.3rem', lineHeight: 1.4 }}>
        {state.message || `Bạn đang dùng v${state.currentVersion}.`}
      </div>

      {state.status === 'downloading' && (
        <div style={{ marginTop: '0.5rem' }}>
          <div style={{ height: '6px', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ width: `${state.downloadPercent}%`, height: '100%', backgroundColor: 'var(--color-primary-hover)' }} />
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            Đang tải... {state.downloadPercent}%
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!isDownloaded || busy}
          onClick={install}
          style={{ fontSize: '0.76rem', padding: '0.35rem 0.8rem', flex: 1 }}
        >
          {isDownloaded ? 'Khởi động lại & cập nhật' : `Đang tải ${state.downloadPercent}%`}
        </button>
      </div>
    </div>
  );
}

/** Popup CHẶN khi bản hiện tại dưới mức tối thiểu của policy. */
export function ForceUpdateModal() {
  const state = useUpdateState();
  const [busy, setBusy] = useState(false);

  if (!state || !state.supported) return null;
  if (state.level !== 'required' || state.forceDisabled) return null;

  const api = getElectronAPI();
  const isDownloaded = state.status === 'downloaded';

  const retry = async () => {
    if (!api) return;
    setBusy(true);
    try { await api.updateCheck(); } finally { setBusy(false); }
  };
  const install = async () => {
    if (!api) return;
    setBusy(true);
    try { await api.updateInstall(); } finally { setBusy(false); }
  };
  const openDownload = async () => { if (api) await api.updateOpenDownload(); };
  const quit = async () => { if (api) await api.quitApp(); };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9500,
      backgroundColor: 'rgba(0,0,0,0.82)', display: 'flex',
      justifyContent: 'center', alignItems: 'center', padding: '1rem',
    }}>
      <div className="card" style={{ maxWidth: '520px', width: '100%', padding: '1.5rem', border: '1px solid var(--color-danger)' }}>
        <h2 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--color-danger)', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          ⚠️ Bắt buộc cập nhật để tiếp tục sử dụng
        </h2>

        <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.55, marginTop: '0.75rem' }}>
          Bản bạn đang dùng (<strong>v{state.currentVersion}</strong>) thấp hơn mức tối thiểu mà hệ thống hỗ trợ
          (<strong>v{state.policy.minimumVersion}</strong>). Vui lòng cập nhật để dữ liệu và tính năng hoạt động đúng.
        </p>

        {state.message && (
          <div style={{
            fontSize: '0.82rem', marginTop: '0.75rem', padding: '0.6rem 0.75rem', borderRadius: '6px',
            backgroundColor: 'rgba(56, 189, 248, 0.08)', border: '1px solid rgba(56, 189, 248, 0.25)',
            color: 'var(--text-primary)', lineHeight: 1.5,
          }}>
            {state.message}
          </div>
        )}

        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.9rem' }}>
          Trạng thái: <strong>{STATUS_LABEL[state.status]}</strong>
          {state.latestVersion ? <> · bản mới nhất: <strong>v{state.latestVersion}</strong></> : null}
          {state.error ? <div style={{ color: 'var(--color-danger)', marginTop: '0.25rem' }}>Lỗi: {state.error}</div> : null}
        </div>

        {state.status === 'downloading' && (
          <div style={{ marginTop: '0.6rem' }}>
            <div style={{ height: '8px', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ width: `${state.downloadPercent}%`, height: '100%', backgroundColor: 'var(--color-primary-hover)' }} />
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              Đang tải... {state.downloadPercent}%
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1.25rem' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={install}
            disabled={!isDownloaded || busy}
            style={{ fontSize: '0.84rem', padding: '0.5rem 1.1rem', flex: '1 1 auto' }}
          >
            {isDownloaded ? 'Cập nhật & khởi động lại ngay' : 'Đang chuẩn bị bản cập nhật...'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={retry} disabled={busy} style={{ fontSize: '0.8rem' }}>
            Thử lại
          </button>
          <button type="button" className="btn btn-secondary" onClick={openDownload} style={{ fontSize: '0.8rem' }}>
            Tải thủ công
          </button>
          <button type="button" className="btn btn-danger" onClick={quit} style={{ fontSize: '0.8rem' }}>
            Thoát ứng dụng
          </button>
        </div>

        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.75rem', lineHeight: 1.45 }}>
          Nếu thoát, bản cập nhật đã tải sẽ được cài tự động ở lần đóng ứng dụng này.
        </p>
      </div>
    </div>
  );
}

/** Khối "Phiên bản & cập nhật" để nhúng vào màn hình cài đặt. */
export function VersionPanel() {
  const state = useUpdateState();
  const [busy, setBusy] = useState(false);
  const api = getElectronAPI();

  const check = useCallback(async () => {
    if (!api) return;
    setBusy(true);
    try { await api.updateCheck(); } finally { setBusy(false); }
  }, [api]);

  if (!api) {
    return (
      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
        Không chạy trong ứng dụng desktop — không có thông tin phiên bản.
      </div>
    );
  }

  const levelText = state?.level === 'required' ? 'Bắt buộc cập nhật'
    : state?.level === 'recommended' ? 'Nên cập nhật' : 'Đã đạt yêu cầu';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.5rem', fontSize: '0.78rem' }}>
        <div>
          <div style={{ color: 'var(--text-secondary)' }}>Phiên bản hiện tại</div>
          <strong>{state ? `v${state.currentVersion}` : '—'}</strong>
        </div>
        <div>
          <div style={{ color: 'var(--text-secondary)' }}>Bản mới nhất</div>
          <strong>{state?.latestVersion ? `v${state.latestVersion}` : '—'}</strong>
        </div>
        <div>
          <div style={{ color: 'var(--text-secondary)' }}>Trạng thái</div>
          <strong>{state ? STATUS_LABEL[state.status] : '—'}</strong>
        </div>
        <div>
          <div style={{ color: 'var(--text-secondary)' }}>Yêu cầu tối thiểu</div>
          <strong>{state ? `v${state.policy.minimumVersion}` : '—'}</strong>
        </div>
        <div>
          <div style={{ color: 'var(--text-secondary)' }}>Lần kiểm tra cuối</div>
          <strong>{state ? formatCheckedAt(state.lastCheckedAt) : '—'}</strong>
        </div>
        <div>
          <div style={{ color: 'var(--text-secondary)' }}>Chính sách</div>
          <strong>{levelText}</strong>
        </div>
      </div>

      {state?.policySource === 'cache' && (
        <div style={{ fontSize: '0.72rem', color: '#fbbf24' }}>
          Không tải được chính sách mới nhất từ GitHub — đang dùng bản lưu gần nhất.
        </div>
      )}
      {state?.forceDisabled && (
        <div style={{ fontSize: '0.72rem', color: '#fbbf24' }}>
          Chế độ hỗ trợ: đang bỏ qua yêu cầu cập nhật bắt buộc (MKT_DISABLE_FORCE_UPDATE=1).
        </div>
      )}
      {state?.status === 'error' && state.error && (
        <div style={{ fontSize: '0.72rem', color: 'var(--color-danger)' }}>{state.error}</div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary" onClick={check} disabled={busy || state?.status === 'unsupported'}
          style={{ fontSize: '0.78rem', padding: '0.35rem 0.8rem' }}>
          {busy ? 'Đang kiểm tra...' : 'Kiểm tra cập nhật'}
        </button>
        {api && (
          <button type="button" className="btn btn-secondary" onClick={() => api.updateOpenDownload()}
            style={{ fontSize: '0.78rem', padding: '0.35rem 0.8rem' }}>
            Mở trang tải
          </button>
        )}
      </div>

      {state?.status === 'unsupported' && (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
          Bản dev/chưa đóng gói: chỉ hiển thị phiên bản, tính năng cập nhật chỉ chạy trong bản cài đặt.
        </div>
      )}
    </div>
  );
}
