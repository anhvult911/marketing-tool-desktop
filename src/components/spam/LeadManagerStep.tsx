import React, { useState } from 'react';

interface LeadManagerStepProps {
  leads: any[];
  selectedLeadIds: Set<number>;
  onToggleSelectLead: (id: number) => void;
  onToggleSelectAllOnPage: (paginatedLeads: any[]) => void;
  onSelectAllFiltered: (filteredList: any[]) => void;
  onDeselectAll: () => void;
  onResetLeads: (all: boolean, ids?: number[]) => void;
  onDeleteLead: (id: number) => void;
  onClearAllLeads: (all: boolean) => void;
  onImportLeads: (e: React.FormEvent) => void;
  uploadLeadFile: (file: File) => void;
  rawLeads: string;
  setRawLeads: (val: string) => void;
  loading: boolean;
  onOpenScrapeDrawer: () => void;
  targetMode: 'crm' | 'quick';
  setTargetMode: (mode: 'crm' | 'quick') => void;
  quickLeadText: string;
  setQuickLeadText: (text: string) => void;
  onSelectCollection?: (sourceTag: string) => void;
}

export default function LeadManagerStep({
  leads,
  selectedLeadIds,
  onToggleSelectLead,
  onToggleSelectAllOnPage,
  onSelectAllFiltered,
  onDeselectAll,
  onResetLeads,
  onDeleteLead,
  onClearAllLeads,
  onImportLeads,
  uploadLeadFile,
  rawLeads,
  setRawLeads,
  loading,
  onOpenScrapeDrawer,
  targetMode,
  setTargetMode,
  quickLeadText,
  setQuickLeadText,
  onSelectCollection
}: LeadManagerStepProps) {
  const [selectedSourceTag, setSelectedSourceTag] = useState<string>('');
  const [leadSearch, setLeadSearch] = useState('');
  const [leadPage, setLeadPage] = useState(0);

  const uniqueSources = Array.from(new Set(leads.map(l => l.source).filter(Boolean))) as string[];

  const filteredLeads = selectedSourceTag
    ? leads.filter(l => l.source === selectedSourceTag)
    : leads;

  const searchedLeads = filteredLeads.filter(l => {
    const term = leadSearch.toLowerCase();
    return (
      l.value.toLowerCase().includes(term) ||
      (l.extra_data && l.extra_data.displayName && l.extra_data.displayName.toLowerCase().includes(term)) ||
      (l.source && l.source.toLowerCase().includes(term))
    );
  });

  const PAGE_SIZE = 10;
  const totalPages = Math.max(1, Math.ceil(searchedLeads.length / PAGE_SIZE));
  const paginatedLeads = searchedLeads.slice(leadPage * PAGE_SIZE, (leadPage + 1) * PAGE_SIZE);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Target Mode Selector Tabs */}
      <div className="card" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              1. Chọn Nguồn Mục tiêu Chiến dịch
            </h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0 0' }}>
              Chọn tập mục tiêu từ Kho Leads CRM hoặc nhập nhanh tức thì cho chiến dịch nhỏ lẻ
            </p>
          </div>

          <a
            href="/leads"
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}
          >
            🎯 Đến Kho Leads (/leads) ➔
          </a>
        </div>

        {/* Dual Mode Picker Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
          <div
            onClick={() => setTargetMode('crm')}
            style={{
              padding: '1.1rem',
              borderRadius: '10px',
              border: targetMode === 'crm' ? '2px solid var(--color-primary-hover)' : '1px solid var(--border-color)',
              backgroundColor: targetMode === 'crm' ? 'rgba(47, 129, 247, 0.08)' : 'rgba(255,255,255,0.01)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.35rem'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, color: targetMode === 'crm' ? 'var(--color-primary-hover)' : 'var(--text-primary)', fontSize: '0.9rem' }}>
              <input
                type="radio"
                name="targetModeRadio"
                checked={targetMode === 'crm'}
                onChange={() => {}}
                style={{ pointerEvents: 'none' }}
              />
              🎯 Cách 1: Chọn từ Kho Leads (`/leads`)
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: '1.5rem', lineHeight: 1.4 }}>
              Chọn từ các Tập/Bộ sưu tập Leads đã được phân loại & quản lý sẵn trong CRM.
            </span>
          </div>

          <div
            onClick={() => setTargetMode('quick')}
            style={{
              padding: '1.1rem',
              borderRadius: '10px',
              border: targetMode === 'quick' ? '2px solid var(--color-primary-hover)' : '1px solid var(--border-color)',
              backgroundColor: targetMode === 'quick' ? 'rgba(47, 129, 247, 0.08)' : 'rgba(255,255,255,0.01)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.35rem'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, color: targetMode === 'quick' ? 'var(--color-primary-hover)' : 'var(--text-primary)', fontSize: '0.9rem' }}>
              <input
                type="radio"
                name="targetModeRadio"
                checked={targetMode === 'quick'}
                onChange={() => {}}
                style={{ pointerEvents: 'none' }}
              />
              ✍️ Cách 2: Nhập nhanh tức thì (Quick Input)
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: '1.5rem', lineHeight: 1.4 }}>
              Dán nhanh danh sách SĐT / Link để test hoặc chạy 1 lần mà không cần lưu vào CRM.
            </span>
          </div>
        </div>

        {/* MODE A: CRM SELECTION */}
        {targetMode === 'crm' ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Lọc theo Tập danh sách:
                </span>
                {uniqueSources.length > 0 ? (
                  <select
                    className="select"
                    value={selectedSourceTag}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedSourceTag(val);
                      setLeadPage(0);
                      if (onSelectCollection) {
                        onSelectCollection(val);
                      }
                    }}
                    style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem', height: 'auto', width: 'auto' }}
                  >
                    <option value="">-- Tất cả Tập Leads ({leads.length}) --</option>
                    {uniqueSources.map(src => (
                      <option key={src} value={src}>{src}</option>
                    ))}
                  </select>
                ) : (
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                    Chưa có nhãn tập lead nào. Bạn có thể nạp tại trang Kho Leads.
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={onOpenScrapeDrawer}
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', border: '1px solid var(--color-primary-hover)', color: 'var(--color-primary-hover)' }}
              >
                🔍 Mở Khay Cào dữ liệu Nhóm ➔
              </button>
            </div>

            {/* Quick table preview */}
            <div className="table-container" style={{ maxHeight: '250px', overflowY: 'auto' }}>
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
                      />
                    </th>
                    <th>Thông tin Lead</th>
                    <th>Nguồn / Tập</th>
                    <th>Kênh</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedLeads.map(lead => (
                    <tr key={lead.id} style={{ opacity: lead.status !== 'pending' ? 0.6 : 1 }}>
                      <td style={{ textAlign: 'center' }}>
                        <input 
                          type="checkbox" 
                          checked={selectedLeadIds.has(lead.id)}
                          onChange={() => onToggleSelectLead(lead.id)}
                          disabled={lead.status !== 'pending'}
                          style={{ cursor: lead.status === 'pending' ? 'pointer' : 'default' }}
                        />
                      </td>
                      <td style={{ fontSize: '0.78rem' }}>
                        {(() => {
                          let extra = lead.extra_data;
                          if (typeof extra === 'string') {
                            try { extra = JSON.parse(extra); } catch(e) {}
                          }

                          let name = extra?.displayName;
                          if (name && typeof name === 'string' && name.includes('\\u')) {
                            name = name.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
                          }
                          const avatarUrl = extra?.avatarUrl;
                          
                          if (name) {
                            return (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {avatarUrl ? (
                                  <img 
                                    src={avatarUrl} 
                                    alt="" 
                                    style={{ width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover' }}
                                    onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                                  />
                                ) : (
                                  <span style={{ fontSize: '0.9rem' }}>👤</span>
                                )}
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                  <strong style={{ color: 'var(--text-primary)', fontSize: '0.8rem' }}>{name}</strong>
                                  {lead.value !== name && (
                                    <span className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                                      {lead.value}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          }
                          
                          return <span className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--text-primary)' }}>{lead.value}</span>;
                        })()}
                      </td>
                      <td style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{lead.source || 'Trực tiếp'}</td>
                      <td><span className="badge badge-platform" style={{ fontSize: '0.6rem' }}>{lead.platform}</span></td>
                      <td>
                        <span className={"badge " + (lead.status === 'pending' ? 'badge-checkpoint' : lead.status === 'sent' ? 'badge-live' : 'badge-die')} style={{ fontSize: '0.6rem' }}>
                          {lead.status === 'pending' ? 'SẴN SÀNG' : lead.status === 'sent' ? 'ĐÃ GỬI' : 'THẤT BẠI'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* MODE B: QUICK ONE-TIME INPUT */
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Dán danh sách mục tiêu tức thì (mỗi mục tiêu một dòng):
              </label>
              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Mẫu tham khảo:</span>
                <a
                  href="/leads_template.csv"
                  download
                  className="btn btn-secondary"
                  style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem', textDecoration: 'none' }}
                >
                  📄 File mẫu (.CSV)
                </a>
                <a
                  href="/leads_template.txt"
                  download
                  className="btn btn-secondary"
                  style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem', textDecoration: 'none' }}
                >
                  📄 File mẫu (.TXT)
                </a>
              </div>
            </div>
            <textarea
              className="textarea font-mono"
              rows={5}
              placeholder="Dán SĐT Zalo, Username Telegram, Link Tweet hoặc Facebook Post tại đây...&#10;Ví dụ:&#10;0981392369&#10;@username_telegram&#10;https://x.com/user/status/12345678"
              value={quickLeadText}
              onChange={(e) => setQuickLeadText(e.target.value)}
              style={{ width: '100%', fontSize: '0.85rem', background: 'rgba(0,0,0,0.1)', marginBottom: '0.75rem' }}
            />
            <div style={{ padding: '0.75rem 1rem', backgroundColor: 'rgba(210, 153, 34, 0.06)', border: '1px solid rgba(210, 153, 34, 0.2)', borderRadius: '6px', fontSize: '0.75rem', color: 'var(--color-warning)' }}>
              💡 <strong>Lưu ý Chạy nhanh:</strong> Danh sách nhập tại đây sẽ chỉ được sử dụng cho riêng chiến dịch này và không lưu trữ vào Kho CRM Leads chính.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
