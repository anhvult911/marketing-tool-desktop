import React, { useState } from 'react';

interface ScrapeTarget {
  id: number;
  type: string;
  value: string;
  status: string;
  platform?: string;
  template_id?: number | null;
  keyword_filter?: string | null;
}

interface SpamTemplate {
  id: number;
  name: string;
  content: string;
}

interface LiveWatcherTabProps {
  targets: ScrapeTarget[];
  templates: SpamTemplate[];
  handleAddTarget: (e: React.FormEvent) => void;
  handleTargetAction: (id: number, action: 'pause' | 'resume') => void;
  handleDeleteTarget: (id: number) => void;
  loading: boolean;
  isBulkMode: boolean;
  setIsBulkMode: (val: boolean) => void;
  bulkTargetText: string;
  setBulkTargetText: (val: string) => void;
  targetPlatform: string;
  setTargetPlatform: (val: string) => void;
  targetType: string;
  setTargetType: (val: string) => void;
  targetValue: string;
  setTargetValue: (val: string) => void;
  handleTargetValuePaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  handlePlatformChange: (platformKey: string) => void;
  showActiveTargetsOnly: boolean;
  setShowActiveTargetsOnly: (val: boolean) => void;
  PLATFORMS_MAP: any;
}

export default function LiveWatcherTab({
  targets,
  templates,
  handleAddTarget,
  handleTargetAction,
  handleDeleteTarget,
  loading,
  isBulkMode,
  setIsBulkMode,
  bulkTargetText,
  setBulkTargetText,
  targetPlatform,
  setTargetPlatform,
  targetType,
  setTargetType,
  targetValue,
  setTargetValue,
  handleTargetValuePaste,
  handlePlatformChange,
  showActiveTargetsOnly,
  setShowActiveTargetsOnly,
  PLATFORMS_MAP
}: LiveWatcherTabProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [keywordFilter, setKeywordFilter] = useState('');

  const displayedTargets = showActiveTargetsOnly 
    ? targets.filter(t => t.status === 'active') 
    : targets;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Overview Banner */}
      <div className="card" style={{ padding: '1.5rem', backgroundColor: 'rgba(47, 129, 247, 0.04)', border: '1px solid rgba(47, 129, 247, 0.2)' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-primary-hover)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          📡 Nguồn Theo dõi & Seeding Bài viết Mới (Live Auto-Seeding Watcher)
        </h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.35rem 0 0 0', lineHeight: 1.5 }}>
          Hệ thống chạy ngầm tự động theo dõi các KOLs, Chuyên mục Diễn đàn hoặc Hashtag. Ngay khi có bài viết mới xuất hiện, worker sẽ tự động xoay vòng tài khoản và để lại bình luận Seeding tức thì.
        </p>
      </div>

      {/* Add New Watcher Target Form */}
      <div className="card" style={{ padding: '1.5rem' }}>
        <form onSubmit={handleAddTarget}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              ➕ Thêm Nguồn Theo dõi Bài mới Mới (KOL / Forum / Hashtag)
            </span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={isBulkMode}
                onChange={(e) => setIsBulkMode(e.target.checked)}
              />
              Nạp hàng loạt (Bulk Mode)
            </label>
          </div>

          {isBulkMode ? (
            <div className="form-group">
              <textarea
                className="textarea font-mono"
                rows={4}
                value={bulkTargetText}
                onChange={(e) => setBulkTargetText(e.target.value)}
                placeholder="Ví dụ:\n@elonmusk\nhttps://newf319.com/forums/thi-truong-chung-khoan\nhttps://facebook.com/groups/123"
                style={{ width: '100%', fontSize: '0.8rem', background: 'rgba(0,0,0,0.1)' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Nền tảng mặc định:</span>
                <select
                  className="select"
                  value={targetPlatform}
                  onChange={(e) => handlePlatformChange(e.target.value)}
                  style={{ height: '1.6rem', padding: '0 0.5rem', fontSize: '0.75rem', width: 'auto' }}
                >
                  {Object.values(PLATFORMS_MAP).map((p: any) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', alignItems: 'end' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Nền tảng</label>
                  <select
                    className="select"
                    value={targetPlatform}
                    onChange={(e) => handlePlatformChange(e.target.value)}
                    style={{ width: '100%', height: '2.1rem', fontSize: '0.8rem' }}
                  >
                    {Object.values(PLATFORMS_MAP).map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.label} {!p.isCrawlerSupported ? '⚠️' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Loại mục tiêu</label>
                  <select
                    className="select"
                    value={targetType}
                    onChange={(e) => setTargetType(e.target.value)}
                    style={{ width: '100%', height: '2.1rem', fontSize: '0.8rem' }}
                  >
                    {PLATFORMS_MAP[targetPlatform]?.targetTypes.map((t: any) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Giá trị mục tiêu (URL / Username)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={targetValue}
                    onChange={(e) => setTargetValue(e.target.value)}
                    onPaste={handleTargetValuePaste}
                    placeholder={PLATFORMS_MAP[targetPlatform]?.targetTypes.find((t: any) => t.value === targetType)?.placeholder || 'Nhập URL/Username'}
                    style={{ width: '100%', height: '2.1rem', fontSize: '0.8rem' }}
                  />
                </div>
              </div>

              {/* Template selection & Keyword Filter */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Kịch bản Seeding Mặc định khi có bài mới</label>
                  <select
                    className="select"
                    value={selectedTemplateId}
                    onChange={(e) => setSelectedTemplateId(e.target.value)}
                    style={{ width: '100%', height: '2.1rem', fontSize: '0.8rem' }}
                  >
                    <option value="">-- Chọn kịch bản từ Thư viện --</option>
                    {templates.map(tpl => (
                      <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Bộ lọc Từ khóa Bắt buộc (Tùy chọn)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Ví dụ: Crypto, BTC, Chứng khoán"
                    value={keywordFilter}
                    onChange={(e) => setKeywordFilter(e.target.value)}
                    style={{ width: '100%', height: '2.1rem', fontSize: '0.8rem' }}
                  />
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
            <button type="submit" className="btn btn-primary" style={{ padding: '0.45rem 1.5rem', fontSize: '0.85rem', fontWeight: 600 }} disabled={loading}>
              📡 Kích hoạt Theo dõi Nguồn Mới
            </button>
          </div>
        </form>
      </div>

      {/* Target Watcher List Table */}
      <div className="card" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Danh sách Nguồn đang Theo dõi ({displayedTargets.length})
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={showActiveTargetsOnly}
              onChange={(e) => setShowActiveTargetsOnly(e.target.checked)}
            />
            Chỉ hiện Active
          </label>
        </div>

        {displayedTargets.length === 0 ? (
          <div style={{ padding: '2rem', border: '1px solid var(--border-color)', borderRadius: '6px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            Chưa có nguồn theo dõi bài viết mới nào.
          </div>
        ) : (
          <div className="table-container" style={{ maxHeight: '350px', overflowY: 'auto' }}>
            <table className="table mini-table">
              <thead>
                <tr>
                  <th>Kênh / Mục tiêu</th>
                  <th>Nền tảng</th>
                  <th>Loại</th>
                  <th>Trạng thái Watcher</th>
                  <th className="text-right">Hành động</th>
                </tr>
              </thead>
              <tbody>
                {displayedTargets.map(t => (
                  <tr key={t.id}>
                    <td>
                      <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{t.value}</strong>
                    </td>
                    <td>
                      <span className="badge badge-platform" style={{ fontSize: '0.65rem', textTransform: 'uppercase' }}>
                        {t.platform}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                        {t.type === 'username' ? 'KOL / User' : t.type === 'category' ? 'Chuyên mục' : 'Hashtag'}
                      </span>
                    </td>
                    <td>
                      <span className={"badge " + (t.status === 'active' ? 'badge-live' : 'badge-checkpoint')} style={{ fontSize: '0.65rem' }}>
                        {t.status === 'active' ? '🔴 DANG CANH BÀI' : 'PAUSED'}
                      </span>
                    </td>
                    <td className="text-right">
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.35rem' }}>
                        {t.status === 'active' ? (
                          <button
                            type="button"
                            onClick={() => handleTargetAction(t.id, 'pause')}
                            className="btn btn-secondary"
                            style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}
                            disabled={loading}
                          >
                            ⏸ Tạm dừng
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleTargetAction(t.id, 'resume')}
                            className="btn btn-secondary"
                            style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}
                            disabled={loading}
                          >
                            ▶ Tiếp tục
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteTarget(t.id)}
                          className="btn btn-danger"
                          style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}
                          disabled={loading}
                        >
                          🗑 Xóa
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
