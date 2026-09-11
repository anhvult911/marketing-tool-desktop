import React from 'react';

interface Lead {
  id: number;
  value: string;
  platform: string;
  display_name?: string | null;
  avatar_url?: string | null;
  source?: string | null;
  status: string;
  extra_data?: any;
}

interface LeadTableProps {
  leads: Lead[];
  selectedLeadIds: Set<number>;
  onToggleSelectLead: (id: number) => void;
  onToggleSelectAllOnPage: (paginatedLeads: Lead[]) => void;
  onSelectAllFiltered: (filteredList: Lead[]) => void;
  onDeselectAll: () => void;
  onResetLeads: (all: boolean, ids?: number[]) => void;
  onDeleteLead: (id: number) => void;
  onClearAllLeads: () => void;
  loading: boolean;
  leadSearch: string;
  setLeadSearch: (val: string) => void;
  selectedSourceFilter: string;
  setSelectedSourceFilter: (val: string) => void;
  uniqueSources: string[];
  leadPage: number;
  setLeadPage: React.Dispatch<React.SetStateAction<number>>;
  onExportCSV?: () => void;
  tableMaxHeight?: string;
  /** P4 — server mode: `leads` đã là 1 trang; tổng số do server trả về. */
  serverTotal?: number;
  /** Server mode: page size do parent sở hữu (phải khớp query gửi lên server). */
  serverPageSize?: number;
  onPageSizeChange?: (size: number) => void;
}

export function detectLeadCategory(lead: Lead) {
  const val = lead.value || '';
  if (lead.platform === 'facebook') {
    const isPostUrl = val.includes('/posts/') || 
                      val.includes('/permalink') || 
                      val.includes('/photos/') || 
                      val.includes('/videos/') || 
                      val.includes('pfbid') ||
                      val.includes('share/p/') ||
                      val.includes('share/v/') ||
                      val.includes('share/r/') ||
                      val.includes('/share/') ||
                      val.includes('/watch') ||
                      val.includes('fbid=');
    return isPostUrl ? { tag: '💬 Bài viết Seeding', type: 'post', className: 'badge-tag-post' }
                     : { tag: '✉️ Cá nhân Inbox', type: 'inbox', className: 'badge-tag-inbox' };
  }
  if (lead.platform === 'telegram') {
    const isGroup = val.includes('t.me/joinchat') || val.includes('t.me/+') || val.includes('/c/');
    return isGroup ? { tag: '📢 Nhóm Telegram', type: 'group', className: 'badge-tag-group' }
                   : { tag: '✉️ Gửi tin nhắn', type: 'inbox', className: 'badge-tag-inbox' };
  }
  if (lead.platform === 'zalo') {
    return { tag: '✉️ Nhắn Zalo (SĐT)', type: 'inbox', className: 'badge-tag-inbox' };
  }
  if (lead.platform === 'x') {
    return { tag: '💬 Comment X (Tweet)', type: 'post', className: 'badge-tag-post' };
  }
  if (lead.platform === 'threads') {
    const isUser = !val.includes('/post/');
    return isUser ? { tag: '📢 Tag Nhắc tên', type: 'inbox', className: 'badge-tag-inbox' }
                  : { tag: '💬 Bình luận', type: 'post', className: 'badge-tag-post' };
  }
  return { tag: '⚡ Tự động', type: 'auto', className: 'badge-tag-post' };
}

export default function LeadTable({
  leads,
  selectedLeadIds,
  onToggleSelectLead,
  onToggleSelectAllOnPage,
  onSelectAllFiltered,
  onDeselectAll,
  onResetLeads,
  onDeleteLead,
  onClearAllLeads,
  loading,
  leadSearch,
  setLeadSearch,
  selectedSourceFilter,
  setSelectedSourceFilter,
  uniqueSources,
  leadPage,
  setLeadPage,
  onExportCSV,
  tableMaxHeight,
  serverTotal,
  serverPageSize,
  onPageSizeChange
}: LeadTableProps) {
  const [pageSize, setPageSize] = React.useState<number>(15);

  const serverMode = typeof serverTotal === 'number';
  // Server mode: page size khớp query của parent (lệch nhau → phân trang sai)
  const effectivePageSize = serverMode ? (serverPageSize ?? pageSize) : pageSize;

  const filteredLeads = selectedSourceFilter
    ? leads.filter(l => l.source === selectedSourceFilter)
    : leads;

  const searchedLeads = filteredLeads.filter(l => {
    const term = leadSearch.toLowerCase();
    return (
      l.value.toLowerCase().includes(term) ||
      (l.extra_data && l.extra_data.displayName && l.extra_data.displayName.toLowerCase().includes(term)) ||
      (l.source && l.source.toLowerCase().includes(term))
    );
  });

  // Server mode: dữ liệu đã lọc/phân trang ở server — không cắt lại client-side
  // (cắt lại sẽ ra trang rỗng khi server trả page 2+ với pageSize khác).
  const visibleLeads = serverMode ? leads : searchedLeads;
  const totalCount = serverMode ? (serverTotal as number) : searchedLeads.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / effectivePageSize));
  const paginatedLeads = serverMode ? leads : searchedLeads.slice(leadPage * effectivePageSize, (leadPage + 1) * effectivePageSize);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            Danh sách Leads ({totalCount})
          </span>
          
          {selectedLeadIds.size > 0 && (
            <span className="badge badge-live" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: '4px', backgroundColor: 'rgba(46, 160, 67, 0.15)', color: 'var(--color-success)' }}>
              ✓ Đã chọn {selectedLeadIds.size} mục tiêu
            </span>
          )}
          
          {/* Client-side search */}
          <input
            type="text"
            placeholder="Tìm kiếm mục tiêu..."
            className="form-input"
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', height: 'auto', width: '150px' }}
            value={leadSearch}
            onChange={(e) => {
              setLeadSearch(e.target.value);
              setLeadPage(0);
            }}
          />

          {/* Bulk Select Actions */}
          {visibleLeads.filter(l => l.status === 'pending').length > 0 && (
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              <button
                type="button"
                onClick={() => onSelectAllFiltered(visibleLeads)}
                className="btn btn-secondary"
                style={{ fontSize: '0.65rem', padding: '0.2rem 0.5rem', height: 'auto', border: '1px solid var(--border-color)', background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-secondary)', cursor: 'pointer' }}
                title="Chọn tất cả các mục tiêu đang hiển thị và ở trạng thái Sẵn sàng"
              >
                ☑️ Chọn tất cả ({visibleLeads.filter(l => l.status === 'pending').length})
              </button>
              <button
                type="button"
                onClick={onDeselectAll}
                className="btn btn-secondary"
                style={{ fontSize: '0.65rem', padding: '0.2rem 0.5rem', height: 'auto', border: '1px solid var(--border-color)', background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                ⬜ Bỏ chọn
              </button>
            </div>
          )}
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {uniqueSources.length > 0 && (
            <select
              className="form-input"
              style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', height: 'auto', width: 'auto', margin: 0 }}
              value={selectedSourceFilter}
              onChange={(e) => {
                setSelectedSourceFilter(e.target.value);
                setLeadPage(0);
              }}
            >
              <option value="">-- Lọc theo nguồn --</option>
              {uniqueSources.map(src => (
                <option key={src} value={src}>{src}</option>
              ))}
            </select>
          )}

          {onExportCSV && (
            <button
              type="button"
              onClick={onExportCSV}
              className="btn btn-secondary"
              style={{ fontSize: '0.7rem', padding: '0.2rem 0.6rem', height: 'auto', border: '1px solid var(--border-color)', color: 'var(--text-primary)', cursor: 'pointer', whiteSpace: 'nowrap' }}
              disabled={leads.length === 0}
              title={selectedLeadIds.size > 0 ? `Xuất ${selectedLeadIds.size} mục tiêu đã tick chọn` : "Xuất toàn bộ danh sách đang hiển thị theo bộ lọc"}
            >
              📥 {selectedLeadIds.size > 0 ? `Export (${selectedLeadIds.size}) mục chọn` : 'Export CSV'}
            </button>
          )}

          {leads.length > 0 && (
            <>
              <button 
                onClick={() => onResetLeads(true)}
                className="btn"
                style={{ fontSize: '0.7rem', padding: '0.2rem 0.6rem', height: 'auto', border: '1px solid var(--color-primary-hover)', background: 'transparent', color: 'var(--color-primary-hover)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                disabled={loading}
              >
                🔄 Reset chờ gửi
              </button>
              <button 
                onClick={onClearAllLeads}
                className="btn"
                style={{ fontSize: '0.7rem', padding: '0.2rem 0.6rem', height: 'auto', border: '1px solid var(--color-danger)', background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                disabled={loading}
              >
                🗑️ Xóa sạch Leads
              </button>
            </>
          )}
        </div>
      </div>

      {visibleLeads.length === 0 ? (
        <div style={{ padding: '2rem', border: '1px solid var(--border-color)', borderRadius: '6px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          {leadSearch || selectedSourceFilter ? 'Không tìm thấy Leads nào khớp với bộ lọc.' : 'Chưa có leads nào. Vui lòng nạp dữ liệu để tiếp tục.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
          <div className="table-container" style={{ flex: '1 1 auto', overflowY: 'auto', minHeight: 0, maxHeight: tableMaxHeight || 'none', marginBottom: '0.75rem' }}>
            <table className="table mini-table">
              <thead>
                <tr>
                  <th style={{ width: '40px', textAlign: 'center' }}>
                    <input 
                      type="checkbox" 
                      checked={paginatedLeads.length > 0 && paginatedLeads.filter(l => l.status === 'pending').every(l => selectedLeadIds.has(l.id))}
                      onChange={() => onToggleSelectAllOnPage(paginatedLeads)}
                      style={{ cursor: 'pointer', transform: 'scale(1.1)' }}
                      disabled={paginatedLeads.filter(l => l.status === 'pending').length === 0}
                      title="Chọn/Bỏ chọn tất cả trang này"
                    />
                  </th>
                  <th>Thông tin Lead</th>
                  <th>Nguồn</th>
                  <th>Kênh</th>
                  <th>Định dạng Tác vụ</th>
                  <th>Trạng thái</th>
                  <th className="text-right">Hành động</th>
                </tr>
              </thead>
              <tbody>
                {paginatedLeads.map(lead => {
                  const category = detectLeadCategory(lead);
                  return (
                    <tr key={lead.id} style={{ opacity: lead.status !== 'pending' ? 0.6 : 1 }}>
                      <td style={{ textAlign: 'center' }}>
                        <input 
                          type="checkbox" 
                          checked={selectedLeadIds.has(lead.id)}
                          onChange={() => onToggleSelectLead(lead.id)}
                          disabled={lead.status !== 'pending'}
                          style={{ cursor: lead.status === 'pending' ? 'pointer' : 'default', transform: 'scale(1.1)' }}
                          title={lead.status !== 'pending' ? "Mục tiêu đã chạy xong hoặc thất bại, không thể chọn lại." : "Chọn mục tiêu"}
                        />
                      </td>
                      <td style={{ fontSize: '0.78rem' }}>
                        {(() => {
                          let val = lead.value || '';
                          const matchUser = val.match(/\/user\/(\d+)/);
                          if (matchUser && matchUser[1]) {
                            val = matchUser[1];
                          }

                          let extra = lead.extra_data;
                          if (typeof extra === 'string') {
                            try { extra = JSON.parse(extra); } catch(e) {}
                          }

                          let displayName = lead.display_name || extra?.displayName || null;
                          if (displayName && typeof displayName === 'string') {
                            if (displayName.includes('\\u')) {
                              displayName = displayName.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
                            }
                            if (displayName.startsWith('/groups/')) {
                              displayName = null;
                            }
                          }

                          const avatarUrl = lead.avatar_url || extra?.avatarUrl;

                          if (lead.platform === 'facebook' || lead.platform === 'messenger') {
                            const isDigits = /^\d+$/.test(val);
                            let url = '';
                            if (val.startsWith('http://') || val.startsWith('https://')) {
                              url = val;
                            } else if (isDigits) {
                              url = `https://www.facebook.com/profile.php?id=${val}`;
                            } else {
                              url = `https://www.facebook.com/${val.replace(/^@/, '')}`;
                            }
                            
                            const primaryName = displayName || (isDigits ? `Facebook User (${val})` : val);

                            return (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {avatarUrl ? (
                                  <img 
                                    src={avatarUrl} 
                                    alt="" 
                                    style={{ width: '26px', height: '26px', borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border-color)' }}
                                    onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                                  />
                                ) : (
                                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', backgroundColor: 'var(--bg-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem' }}>
                                    👤
                                  </div>
                                )}
                                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                  <a 
                                    href={url} 
                                    target="_blank" 
                                    rel="noreferrer" 
                                    style={{ color: 'var(--color-primary-hover)', fontWeight: 600, textDecoration: 'none', lineHeight: 1.2 }}
                                    onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
                                    onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
                                  >
                                    {primaryName}
                                  </a>
                                  {val && val !== primaryName && (
                                    <span className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', lineHeight: 1.1 }}>
                                      {isDigits ? `UID: ${val}` : val}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          } else if (lead.platform === 'telegram') {
                            let cleanUser = val.replace(/^(https?:\/\/)?(www\.)?t\.me\//, "").replace(/^@/, "");
                            const url = "https://t.me/" + cleanUser;
                            const primaryName = displayName || `@${cleanUser}`;
                            return (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '0.9rem' }}>✈️</span>
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                  <a href={url} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary-hover)', fontWeight: 600, textDecoration: 'underline' }}>
                                    {primaryName}
                                  </a>
                                  {displayName && displayName !== `@${cleanUser}` && (
                                    <span className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>@{cleanUser}</span>
                                  )}
                                </div>
                              </div>
                            );
                          } else if (lead.platform === 'x') {
                            let cleanUser = val.replace(/^(https?:\/\/)?(www\.)?(x|twitter)\.com\//, "").replace(/^@/, "");
                            const url = "https://x.com/" + cleanUser;
                            const primaryName = displayName || `@${cleanUser}`;
                            return (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '0.9rem' }}>🐦</span>
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                  <a href={url} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary-hover)', fontWeight: 600, textDecoration: 'underline' }}>
                                    {primaryName}
                                  </a>
                                  {displayName && displayName !== `@${cleanUser}` && (
                                    <span className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>@{cleanUser}</span>
                                  )}
                                </div>
                              </div>
                            );
                          } else if (lead.platform === 'zalo' || lead.platform === 'whatsapp') {
                            const icon = lead.platform === 'zalo' ? '📞' : '📱';
                            const primaryName = displayName || val;
                            return (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span>{icon}</span>
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                  <strong style={{ color: 'var(--text-primary)' }}>{primaryName}</strong>
                                  {displayName && displayName !== val && (
                                    <span className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>{val}</span>
                                  )}
                                </div>
                              </div>
                            );
                          }
                          return <span className="font-mono">{displayName || val}</span>;
                        })()}
                      </td>
                      <td>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                          {lead.source || 'Trực tiếp'}
                        </span>
                      </td>
                      <td>
                        <span className="badge badge-platform" style={{ fontSize: '0.65rem', textTransform: 'uppercase' }}>
                          {lead.platform}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${category.className}`} style={{ fontSize: '0.65rem' }}>
                          {category.tag}
                        </span>
                      </td>
                      <td>
                        <span className={"badge " + (lead.status === 'pending' ? 'badge-checkpoint' : lead.status === 'sent' ? 'badge-live' : 'badge-die')} style={{ fontSize: '0.65rem' }}>
                          {lead.status === 'pending' ? 'SẴN SÀNG' : lead.status === 'sent' ? 'ĐÃ GỬI' : 'THẤT BẠI'}
                        </span>
                      </td>
                      <td className="text-right">
                        {lead.status !== 'pending' && (
                          <button 
                            type="button"
                            onClick={() => onResetLeads(false, [lead.id])}
                            className="icon-action-btn btn-primary"
                            title="Đặt lại trạng thái Chờ gửi"
                            disabled={loading}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', marginRight: '0.5rem', color: 'var(--color-primary-hover)' }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
                            </svg>
                          </button>
                        )}
                        <button 
                          type="button"
                          onClick={() => onDeleteLead(lead.id)}
                          className="icon-action-btn btn-danger"
                          title="Xóa"
                          disabled={loading}
                          style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Trang {leadPage + 1} / {totalPages} (Hiển thị {paginatedLeads.length} của {totalCount} mục tiêu)
              </span>

              {/* Dynamic Page Size Selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                <span>| Xem:</span>
                <select
                  value={effectivePageSize}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (serverMode) onPageSizeChange?.(n);
                    else setPageSize(n);
                    setLeadPage(0);
                  }}
                  style={{ fontSize: '0.75rem', padding: '0.15rem 0.35rem', borderRadius: '4px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                >
                  <option value={15}>15 hàng/trang</option>
                  <option value={30}>30 hàng/trang</option>
                  <option value={50}>50 hàng/trang</option>
                  <option value={100}>100 hàng/trang</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.35rem' }}>
              <button
                type="button"
                onClick={() => setLeadPage(prev => Math.max(0, prev - 1))}
                disabled={leadPage === 0}
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem', height: 'auto' }}
              >
                ◄ Trước
              </button>
              <button
                type="button"
                onClick={() => setLeadPage(prev => Math.min(totalPages - 1, prev + 1))}
                disabled={leadPage === totalPages - 1}
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem', height: 'auto' }}
              >
                Sau ►
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
