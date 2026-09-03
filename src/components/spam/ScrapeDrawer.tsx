import React, { useState, useEffect } from 'react';

interface Account {
  id: number;
  platform: string;
  username: string;
  status: string;
}

interface Campaign {
  campaign_id: string;
}

interface ScrapeDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Account[];
  campaigns: Campaign[];
  onSuccess: () => void;
}

interface ScrapeJob {
  id: number;
  platform: string;
  target_group: string;
  status: string;
  total_count: number;
  error_msg: string | null;
  auto_import: boolean;
  target_campaign_id: string | null;
  created_at: string;
  custom_tag?: string | null;
  scrape_type?: string | null;
}

interface ScrapedLead {
  id: number;
  uid: string;
  display_name: string;
  avatar_url: string;
}

async function safeFetchJson(url: string, options?: RequestInit) {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    if (!text || !text.trim()) {
      return { success: false, error: `Máy chủ trả về phản hồi rỗng (HTTP ${res.status}).` };
    }
    try {
      return JSON.parse(text);
    } catch {
      return { success: false, error: `Phản hồi máy chủ không phải JSON (HTTP ${res.status}).` };
    }
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi kết nối máy chủ.' };
  }
}

export default function ScrapeDrawer({ isOpen, onClose, accounts, campaigns, onSuccess }: ScrapeDrawerProps) {
  const [targetGroup, setTargetGroup] = useState('');
  const [selectedAccountIds, setSelectedAccountIds] = useState<number[]>([]);
  const [maxLimit, setMaxLimit] = useState<number>(5000);
  const [autoImport, setAutoImport] = useState(true);
  const [scrapeType, setScrapeType] = useState<'members' | 'chat_history' | 'hybrid' | 'kol_followers' | 'post_commenters' | 'multi_tier'>('multi_tier');
  const [customTag, setCustomTag] = useState('');
  
  const [activeTab, setActiveTab] = useState<'create' | 'history'>('create');
  const [jobs, setJobs] = useState<ScrapeJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [scrapedLeads, setScrapedLeads] = useState<ScrapedLead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [activeErrorJob, setActiveErrorJob] = useState<ScrapeJob | null>(null);

  // Filters & Pagination for History Tab
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'processing' | 'failed'>('all');
  const [platformFilter, setPlatformFilter] = useState<'all' | 'telegram' | 'facebook'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [pageSize, setPageSize] = useState<number>(10);
  const [historyPage, setHistoryPage] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState<'telegram' | 'facebook' | 'messenger'>('facebook');
  const [internalAccounts, setInternalAccounts] = useState<Account[]>([]);

  const fetchAccounts = async () => {
    const data = await safeFetchJson('/api/accounts');
    if (data.success && Array.isArray(data.data)) {
      setInternalAccounts(data.data);
    }
  };

  const allAccounts = internalAccounts.length > 0 ? internalAccounts : (accounts || []);

  const scraperAccounts = allAccounts.filter(a => {
    const targetPlatform = selectedPlatform === 'messenger' ? 'facebook' : selectedPlatform;
    const plat = (a.platform || '').toLowerCase().trim();
    const stat = (a.status || '').toLowerCase().trim();
    return plat === targetPlatform.toLowerCase() && (stat === 'live' || stat === 'ready' || stat === 'active');
  });

  const fetchJobs = async () => {
    const data = await safeFetchJson('/api/spam/scrape');
    if (data.success) {
      setJobs(data.data || []);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchJobs();
      fetchAccounts();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      if (scraperAccounts.length > 0) {
        setSelectedAccountIds(scraperAccounts.map(a => a.id));
      } else {
        setSelectedAccountIds([]);
      }
    }
  }, [isOpen, activeTab, selectedPlatform, internalAccounts, accounts]);

  const handleToggleAccount = (id: number) => {
    setSelectedAccountIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleSelectAllAccounts = () => {
    setSelectedAccountIds(scraperAccounts.map(a => a.id));
  };

  const handleDeselectAllAccounts = () => {
    setSelectedAccountIds([]);
  };

  useEffect(() => {
    if (scrapeType === 'post_commenters') {
      setMaxLimit(500);
    } else {
      setMaxLimit(5000);
    }
  }, [scrapeType]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    const hasActiveJob = jobs.some(j => j.status === 'pending' || j.status === 'processing');
    
    if (isOpen && hasActiveJob) {
      interval = setInterval(() => {
        fetchJobs();
        onSuccess();
      }, 4000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isOpen, jobs]);

  useEffect(() => {
    const fetchLeads = async () => {
      if (!selectedJobId) return;
      setLoadingLeads(true);
      const data = await safeFetchJson(`/api/spam/scrape?jobId=${selectedJobId}`);
      if (data.success) {
        setScrapedLeads(data.data || []);
      }
      setLoadingLeads(false);
    };

    fetchLeads();
  }, [selectedJobId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSubmitting(true);

    if (!targetGroup.trim()) {
      setError('Vui lòng nhập link nhóm hoặc username nhóm.');
      setSubmitting(false);
      return;
    }

    if (!selectedAccountIds || selectedAccountIds.length === 0) {
      setError(`Vui lòng chọn ít nhất 1 tài khoản ${selectedPlatform === 'telegram' ? 'Telegram' : 'Facebook'} Live để cào dữ liệu.`);
      setSubmitting(false);
      return;
    }

    try {
      const data = await safeFetchJson('/api/spam/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: selectedPlatform,
          targetGroup: targetGroup.trim(),
          accountIds: selectedAccountIds,
          accountId: selectedAccountIds[0],
          maxLimit,
          autoImport,
          scrapeType,
          customTag: customTag.trim() || undefined,
        }),
      });

      if (data.success) {
        setSuccess('Đã khởi tạo tác vụ cào dữ liệu thành công! Tiến trình đang chạy ngầm.');
        setTargetGroup('');
        setCustomTag('');
        fetchJobs();
        onSuccess();
        setTimeout(() => setActiveTab('history'), 800);
      } else {
        setError(data.error || 'Có lỗi xảy ra khi tạo tiến trình cào.');
      }
    } catch (err: any) {
      setError(err.message || 'Lỗi kết nối máy chủ.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReRunJob = async (jobId: number) => {
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const data = await safeFetchJson('/api/spam/scrape', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, action: 'rerun' })
      });
      if (data.success) {
        setSuccess(data.message || 'Đã đưa tiến trình cào trở lại hàng đợi!');
        fetchJobs();
      } else {
        setError(data.error || 'Không thể chạy lại tiến trình.');
      }
    } catch (err: any) {
      setError(err.message || 'Lỗi mạng.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStopJob = async (jobId: number) => {
    if (!confirm(`Bạn có chắc chắn muốn DỪNG ĐỘT NGỘT tiến trình cào #${jobId}?`)) return;
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const data = await safeFetchJson('/api/spam/scrape', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, action: 'stop' })
      });
      if (data.success) {
        setSuccess(data.message || 'Đã dừng tiến trình cào thành công.');
        fetchJobs();
      } else {
        setError(data.error || 'Không thể dừng tiến trình.');
      }
    } catch (err: any) {
      setError(err.message || 'Lỗi mạng.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteJob = async (jobId: number) => {
    if (!confirm('Bạn có chắc chắn muốn xóa tiến trình cào này cùng toàn bộ dữ liệu tạm liên quan?')) return;
    setSubmitting(true);
    try {
      const data = await safeFetchJson('/api/spam/scrape', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId })
      });
      if (data.success) {
        setSuccess(data.message || 'Đã xóa tiến trình cào thành công.');
        if (selectedJobId === jobId) setSelectedJobId(null);
        fetchJobs();
      } else {
        setError(data.error || 'Lỗi khi xóa.');
      }
    } catch (err: any) {
      setError(err.message || 'Lỗi mạng.');
    } finally {
      setSubmitting(false);
    }
  };

  // Status counts
  const statusCounts = {
    all: jobs.length,
    completed: jobs.filter(j => j.status === 'completed').length,
    processing: jobs.filter(j => j.status === 'processing' || j.status === 'pending').length,
    failed: jobs.filter(j => j.status === 'failed' || j.status === 'error' || j.status === 'stopped').length,
  };

  // Filtered jobs calculation
  const filteredJobs = jobs.filter(job => {
    if (statusFilter === 'completed' && job.status !== 'completed') return false;
    if (statusFilter === 'processing' && job.status !== 'processing' && job.status !== 'pending') return false;
    if (statusFilter === 'failed' && job.status !== 'failed' && job.status !== 'error' && job.status !== 'stopped') return false;
    if (platformFilter !== 'all') {
      if (platformFilter === 'telegram' && job.platform !== 'telegram') return false;
      if (platformFilter === 'facebook' && job.platform !== 'facebook' && job.platform !== 'messenger') return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const target = (job.target_group || '').toLowerCase();
      const tag = (job.custom_tag || '').toLowerCase();
      const idStr = String(job.id);
      const plat = (job.platform || '').toLowerCase();
      return target.includes(q) || tag.includes(q) || idStr.includes(q) || plat.includes(q);
    }
    return true;
  });

  // Pagination logic for history table
  const totalHistoryPages = Math.max(1, Math.ceil(filteredJobs.length / pageSize));
  const paginatedJobs = filteredJobs.slice(historyPage * pageSize, (historyPage + 1) * pageSize);

  const formatDateTime = (dateStr?: string) => {
    if (!dateStr) return { time: '--', date: '--' };
    try {
      const d = new Date(dateStr);
      return {
        time: d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        date: d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
      };
    } catch {
      return { time: '--', date: dateStr };
    }
  };

  const formatTargetGroup = (target: string) => {
    if (!target) return '--';
    try {
      let clean = target
        .replace(/^https?:\/\/(www\.)?facebook\.com\//i, '')
        .replace(/^https?:\/\/(www\.)?t\.me\//i, '@')
        .replace(/\/$/, '');
      return clean || target;
    } catch {
      return target;
    }
  };

  return (
    <div className="ux-drawer-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.75)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '1rem' }}>
      <div className="card" style={{ width: '95%', maxWidth: '1250px', height: '88vh', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '12px', boxShadow: '0 12px 48px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {/* Header */}
        <div style={{ padding: '1.1rem 1.75rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-primary)' }}>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              🤖 Công Cụ Cào & Thu Thập Leads Tự Động (Auto Group Scraper Hub)
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.15rem 0 0 0' }}>
              Thu thập dữ liệu thành viên & lịch sử chat từ nhóm Facebook và Telegram
            </p>
          </div>
          <button 
            type="button" 
            onClick={onClose}
            style={{ padding: '0.3rem 0.6rem', fontSize: '1.3rem', border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', borderRadius: '4px' }}
            title="Đóng cửa sổ"
          >
            ✕
          </button>
        </div>

        {/* Tab switcher */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', padding: '0 1.75rem', backgroundColor: 'rgba(0,0,0,0.1)' }}>
          <button
            type="button"
            onClick={() => setActiveTab('create')}
            style={{
              padding: '0.75rem 1.25rem',
              border: 'none',
              background: 'none',
              borderBottom: activeTab === 'create' ? '2px solid var(--color-primary-hover)' : '2px solid transparent',
              color: activeTab === 'create' ? 'var(--color-primary-hover)' : 'var(--text-secondary)',
              fontWeight: activeTab === 'create' ? 700 : 500,
              fontSize: '0.88rem',
              cursor: 'pointer'
            }}
          >
            ➕ Khởi Tạo Tiến Trình Cào Mới
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            style={{
              padding: '0.75rem 1.25rem',
              border: 'none',
              background: 'none',
              borderBottom: activeTab === 'history' ? '2px solid var(--color-primary-hover)' : '2px solid transparent',
              color: activeTab === 'history' ? 'var(--color-primary-hover)' : 'var(--text-secondary)',
              fontWeight: activeTab === 'history' ? 700 : 500,
              fontSize: '0.88rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
          >
            📊 Nhật Ký & Tiến Trình Cào Dữ Liệu ({jobs.length})
            {statusCounts.processing > 0 && (
              <span className="badge badge-live" style={{ fontSize: '0.65rem', animation: 'pulse 1.5s infinite' }}>
                ⚡ {statusCounts.processing} ĐANG CHẠY
              </span>
            )}
          </button>
        </div>

        {/* Body Content Container */}
        <div style={{ 
          flex: 1, 
          padding: activeTab === 'create' ? '1.5rem' : '1rem 1.5rem', 
          overflowY: activeTab === 'create' ? 'auto' : 'hidden', 
          display: 'flex', 
          flexDirection: 'column',
          minHeight: 0 
        }}>
          {error && (
            <div style={{ padding: '0.6rem 1rem', backgroundColor: 'rgba(248,81,73,0.15)', border: '1px solid var(--color-danger)', borderRadius: '6px', color: 'var(--color-danger)', fontSize: '0.82rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>⚠️ {error}</span>
              <button type="button" onClick={() => setError('')} style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer' }}>✕</button>
            </div>
          )}

          {success && (
            <div style={{ padding: '0.6rem 1rem', backgroundColor: 'rgba(63,185,80,0.15)', border: '1px solid var(--color-success)', borderRadius: '6px', color: 'var(--color-success)', fontSize: '0.82rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>✓ {success}</span>
              <button type="button" onClick={() => setSuccess('')} style={{ background: 'none', border: 'none', color: 'var(--color-success)', cursor: 'pointer' }}>✕</button>
            </div>
          )}

          {/* TAB 1: CREATE NEW SCRAPE JOB */}
          {activeTab === 'create' && (
            <form onSubmit={handleSubmit} style={{ maxWidth: '850px', margin: '0 auto', width: '100%' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                
                {/* Platform Selector Cards */}
                <div>
                  <label className="form-label" style={{ fontSize: '0.82rem', fontWeight: 600 }}>1. Chọn Nền tảng Mục tiêu</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                    <div 
                      onClick={() => setSelectedPlatform('telegram')}
                      style={{
                        padding: '1rem',
                        borderRadius: '8px',
                        border: selectedPlatform === 'telegram' ? '2px solid var(--color-primary-hover)' : '1px solid var(--border-color)',
                        backgroundColor: selectedPlatform === 'telegram' ? 'rgba(47,129,247,0.08)' : 'rgba(255,255,255,0.01)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        fontWeight: 600,
                        fontSize: '0.85rem'
                      }}
                    >
                      ✈️ Telegram (Nhóm / Channel)
                    </div>

                    <div 
                      onClick={() => setSelectedPlatform('facebook')}
                      style={{
                        padding: '1rem',
                        borderRadius: '8px',
                        border: selectedPlatform === 'facebook' ? '2px solid var(--color-primary-hover)' : '1px solid var(--border-color)',
                        backgroundColor: selectedPlatform === 'facebook' ? 'rgba(47,129,247,0.08)' : 'rgba(255,255,255,0.01)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        fontWeight: 600,
                        fontSize: '0.85rem'
                      }}
                    >
                      📘 Facebook Groups
                    </div>

                    <div 
                      onClick={() => setSelectedPlatform('messenger')}
                      style={{
                        padding: '1rem',
                        borderRadius: '8px',
                        border: selectedPlatform === 'messenger' ? '2px solid var(--color-primary-hover)' : '1px solid var(--border-color)',
                        backgroundColor: selectedPlatform === 'messenger' ? 'rgba(47,129,247,0.08)' : 'rgba(255,255,255,0.01)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        fontWeight: 600,
                        fontSize: '0.85rem'
                      }}
                    >
                      💬 Messenger Group Link
                    </div>
                  </div>
                </div>

                {/* Multi-Account Selection Panel */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                    <label className="form-label" style={{ fontSize: '0.8rem', margin: 0 }}>
                      2. Tài khoản Quét phụ trách (Status: Live) — <span style={{ color: '#60a5fa' }}>Chọn nhiều nick để chạy song song</span>
                    </label>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      {scraperAccounts.length > 0 && (
                        <>
                          <button
                            type="button"
                            onClick={handleSelectAllAccounts}
                            style={{
                              fontSize: '0.72rem',
                              padding: '0.15rem 0.5rem',
                              borderRadius: '4px',
                              border: '1px solid #3b82f6',
                              background: 'rgba(59, 130, 246, 0.15)',
                              color: '#60a5fa',
                              cursor: 'pointer',
                              fontWeight: 600
                            }}
                          >
                            ⚡ Chọn tất cả ({scraperAccounts.length})
                          </button>
                          {selectedAccountIds.length > 0 && (
                            <button
                              type="button"
                              onClick={handleDeselectAllAccounts}
                              style={{
                                fontSize: '0.72rem',
                                padding: '0.15rem 0.45rem',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color)',
                                background: 'transparent',
                                color: 'var(--text-secondary)',
                                cursor: 'pointer'
                              }}
                            >
                              Bỏ chọn
                            </button>
                          )}
                        </>
                      )}
                      <span style={{ 
                        fontSize: '0.75rem', 
                        fontWeight: 700, 
                        color: selectedAccountIds.length > 0 ? '#4ade80' : '#f87171',
                        backgroundColor: selectedAccountIds.length > 0 ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)',
                        padding: '0.15rem 0.45rem',
                        borderRadius: '4px',
                        border: `1px solid ${selectedAccountIds.length > 0 ? 'rgba(74, 222, 128, 0.3)' : 'rgba(248, 113, 113, 0.3)'}`
                      }}>
                        Đã chọn: {selectedAccountIds.length}/{scraperAccounts.length} nick Live
                      </span>
                    </div>
                  </div>

                  {scraperAccounts.length === 0 ? (
                    <div style={{ padding: '0.75rem 1rem', borderRadius: '6px', border: '1px dashed #f87171', backgroundColor: 'rgba(248, 113, 113, 0.08)', fontSize: '0.82rem', color: '#f87171' }}>
                      ⚠️ Không tìm thấy tài khoản {selectedPlatform === 'telegram' ? 'Telegram' : 'Facebook'} nào ở trạng thái <strong>LIVE</strong>. Vui lòng thêm tài khoản hoặc đăng nhập Live trên VPS trước khi cào.
                    </div>
                  ) : (
                    <div style={{
                      maxHeight: '140px',
                      overflowY: 'auto',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-primary)',
                      padding: '0.4rem',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                      gap: '0.4rem'
                    }}>
                      {scraperAccounts.map(acc => {
                        const isSelected = selectedAccountIds.includes(acc.id);
                        return (
                          <div
                            key={acc.id}
                            onClick={() => handleToggleAccount(acc.id)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                              padding: '0.35rem 0.6rem',
                              borderRadius: '6px',
                              backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                              border: isSelected ? '1px solid #3b82f6' : '1px solid var(--border-color)',
                              cursor: 'pointer',
                              userSelect: 'none',
                              transition: 'all 0.15s ease'
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {}} // Click handled by wrapper div
                              style={{ cursor: 'pointer' }}
                            />
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                              <span style={{ fontSize: '0.8rem', fontWeight: isSelected ? 700 : 500, color: isSelected ? '#ffffff' : 'var(--text-secondary)' }}>
                                @{acc.username}
                              </span>
                            </div>
                            <span className="badge badge-live" style={{ fontSize: '0.6rem', padding: '0.1rem 0.3rem', marginLeft: 'auto' }}>
                              LIVE
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '0.8rem' }}>3. Tên KOL / Fanpage / Tag Nhãn nguồn (Source Tag)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Ví dụ: KOL_NguyenVanA, Fanpage_XYZ..."
                    value={customTag}
                    onChange={(e) => setCustomTag(e.target.value)}
                    style={{ width: '100%', fontSize: '0.82rem', height: '2.4rem' }}
                  />
                </div>

                {selectedPlatform === 'telegram' ? (
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.8rem' }}>Kiểu quét Telegram:</label>
                    <select 
                      className="select"
                      value={scrapeType}
                      onChange={(e) => setScrapeType(e.target.value as any)}
                      style={{ width: '100%', fontSize: '0.82rem', height: '2.4rem' }}
                    >
                      <option value="members">👥 Thành viên trực tiếp (Tự động chuyển đổi nếu nhóm ẩn)</option>
                      <option value="hybrid">⚡ Thuật toán Lai Đa chiều & IndexedDB (Khuyên dùng cho nhóm ẩn)</option>
                      <option value="chat_history">💬 Tin nhắn từ lịch sử chat (Multi-Vector Chat)</option>
                    </select>
                  </div>
                ) : selectedPlatform === 'facebook' ? (
                  <div style={{
                    backgroundColor: 'rgba(56, 189, 248, 0.08)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    borderRadius: '8px',
                    padding: '0.75rem 1rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem'
                  }}>
                    <span style={{ fontSize: '1.4rem' }}>🌟</span>
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#38bdf8', marginBottom: '0.15rem' }}>
                        Chế độ Quét Toàn Diện Tối Đa (360° All-in-One Multi-Vector)
                      </div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: '1.3' }}>
                        Tự động bóc tách toàn diện: <strong>Người theo dõi + Cảm xúc (Like/Love/Care) + Bình luận & Trả lời + Nhóm cộng đồng</strong> từ Fanpage / Profile / Nhóm mục tiêu.
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '0.8rem' }}>
                    {selectedPlatform === 'telegram' 
                      ? '4. Đường dẫn / Username Nhóm Telegram mục tiêu' 
                      : '4. Đường dẫn Fanpage / Nhóm / Profile Facebook mục tiêu:'}
                  </label>
                  <input
                    type="text"
                    className="form-input font-mono"
                    placeholder={selectedPlatform === 'telegram' ? 'https://t.me/ten_nhom hoặc https://t.me/+invite_hash' : 'https://facebook.com/tintucUSstock hoặc https://facebook.com/groups/123456789'}
                    value={targetGroup}
                    onChange={(e) => setTargetGroup(e.target.value)}
                    style={{ width: '100%', fontSize: '0.85rem', height: '2.4rem' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'center' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.8rem' }}>
                      {scrapeType === 'post_commenters' ? 'Số bài viết gần nhất cần quét:' : 'Giới hạn cào tối đa (Max Limit):'}
                    </label>
                    <input
                      type="number"
                      className="form-input"
                      value={maxLimit}
                      placeholder={scrapeType === 'post_commenters' ? 'Mặc định: 50 bài post' : 'Mặc định: 2000'}
                      onChange={(e) => setMaxLimit(parseInt(e.target.value, 10) || 0)}
                      style={{ width: '100%', fontSize: '0.82rem', height: '2.4rem' }}
                    />
                  </div>

                  <div style={{ marginTop: '1.25rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={autoImport}
                        onChange={(e) => setAutoImport(e.target.checked)}
                      />
                      ⚡ Tự động lưu thẳng vào Kho Leads khi cào xong
                    </label>
                  </div>
                </div>

                {/* Live Account & Scraping Speed Estimator Widget */}
                {maxLimit > 0 && (
                  <div className="estimator-box" style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    fontSize: '0.85rem'
                  }}>
                    {(() => {
                      const selectedCount = selectedAccountIds.length;
                      const totalLive = scraperAccounts.length;
                      const effectiveCount = Math.max(1, selectedCount);
                      const recommendedAccounts = maxLimit <= 500 ? 1 : maxLimit <= 2000 ? 4 : maxLimit <= 5000 ? 8 : 15;
                      const hoursRecommended = (maxLimit / (400 * recommendedAccounts)).toFixed(1);
                      const hoursCurrent = (maxLimit / (400 * effectiveCount)).toFixed(1);

                      return (
                        <div>
                          <div style={{ fontWeight: 600, color: '#38bdf8', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>📊 Ước tính hiệu năng & Phân bổ tải song song (Swarm Engine):</span>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', color: '#cbd5e1' }}>
                            <div>
                              • Tài khoản đang chọn: <strong style={{ color: selectedCount > 1 ? '#4ade80' : '#fbbf24' }}>{selectedCount} Live {selectedCount > 1 ? '(Chạy song song ⚡)' : ''}</strong>
                            </div>
                            <div>
                              • Thời gian ước tính: <strong style={{ color: selectedCount >= recommendedAccounts ? '#4ade80' : '#38bdf8' }}>~{hoursCurrent} giờ</strong>
                            </div>
                            <div>
                              • Tổng tài khoản Live sẵn có: <strong>{totalLive} Live</strong>
                            </div>
                            <div>
                              • Thời gian tối ưu ({recommendedAccounts} nick): <strong style={{ color: '#4ade80' }}>~{hoursRecommended} giờ</strong>
                            </div>
                          </div>

                          {selectedCount > 1 ? (
                            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed rgba(255,255,255,0.1)', color: '#4ade80', fontSize: '0.8rem' }}>
                              🚀 <strong>Đa luồng Swarm Engine kích hoạt:</strong> Chạy song song <strong>{selectedCount} tài khoản Live</strong> sẽ tăng tốc độ cào gấp <strong>{selectedCount} lần</strong> và phân tán request để chống checkpoint 100%!
                            </div>
                          ) : totalLive > 1 ? (
                            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed rgba(255,255,255,0.1)', color: '#fbbf24', fontSize: '0.8rem' }}>
                              💡 <strong>Mẹo tăng tốc ⚡:</strong> Bạn đang có {totalLive} nick Live. Hãy bấm <strong>[⚡ Chọn tất cả]</strong> ở trên để cào đồng thời nhiều nick, rút ngắn thời gian xuống chỉ còn <strong>~{(maxLimit / (400 * totalLive)).toFixed(1)}h</strong>!
                            </div>
                          ) : null}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Safety & Performance Badge */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.65rem 0.9rem',
                  backgroundColor: 'rgba(59, 130, 246, 0.08)',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                  borderRadius: '8px',
                  fontSize: '0.78rem',
                  flexWrap: 'wrap',
                  gap: '0.5rem'
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#93c5fd', fontWeight: 600 }}>
                    🛡️ Multi-Account Rotation & Circuit Breaker chống checkpoint
                  </span>
                  <span style={{ color: '#86efac', fontWeight: 600 }}>
                    ⚡ Dual-Engine GraphQL Stream + Bóc tách SĐT/Zalo tự động
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                  <button type="submit" className="btn btn-primary" style={{ padding: '0.65rem 2rem', fontSize: '0.9rem', fontWeight: 700 }} disabled={submitting || selectedAccountIds.length === 0}>
                    {submitting ? 'Đang kích hoạt...' : `🚀 KÍCH HOẠT CÀO DỮ LIỆU (${selectedAccountIds.length} NICK)`}
                  </button>
                </div>

              </div>
            </form>
          )}

          {/* TAB 2: FULL-WIDTH SCRAPE HISTORY TABLE WITH PAGINATION */}
          {activeTab === 'history' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: '0.75rem' }}>
              {/* Filter and Search Bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', backgroundColor: 'rgba(0,0,0,0.15)', padding: '0.6rem 0.85rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                {/* Status Filter Chips */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => { setStatusFilter('all'); setHistoryPage(0); }}
                    className={`btn ${statusFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem' }}
                  >
                    Tất cả ({statusCounts.all})
                  </button>
                  <button
                    type="button"
                    onClick={() => { setStatusFilter('processing'); setHistoryPage(0); }}
                    className={`btn ${statusFilter === 'processing' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem' }}
                  >
                    ⚡ Đang chạy ({statusCounts.processing})
                  </button>
                  <button
                    type="button"
                    onClick={() => { setStatusFilter('completed'); setHistoryPage(0); }}
                    className={`btn ${statusFilter === 'completed' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem' }}
                  >
                    ✓ Hoàn thành ({statusCounts.completed})
                  </button>
                  <button
                    type="button"
                    onClick={() => { setStatusFilter('failed'); setHistoryPage(0); }}
                    className={`btn ${statusFilter === 'failed' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem' }}
                  >
                    ✕ Thất bại ({statusCounts.failed})
                  </button>
                </div>

                {/* Search & Platform & Refresh */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <select
                    className="select"
                    value={platformFilter}
                    onChange={(e) => { setPlatformFilter(e.target.value as any); setHistoryPage(0); }}
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', height: '2rem' }}
                  >
                    <option value="all">🌐 Mọi nền tảng</option>
                    <option value="telegram">✈️ Telegram</option>
                    <option value="facebook">📘 Facebook</option>
                  </select>

                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="🔍 Tìm nhóm, tag, #ID..."
                      value={searchQuery}
                      onChange={(e) => { setSearchQuery(e.target.value); setHistoryPage(0); }}
                      style={{ fontSize: '0.75rem', padding: '0.25rem 1.6rem 0.25rem 0.6rem', height: '2rem', width: '180px' }}
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => { setSearchQuery(''); setHistoryPage(0); }}
                        style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.8rem', padding: 0 }}
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <button 
                    type="button" 
                    onClick={fetchJobs} 
                    className="btn btn-secondary" 
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem', height: '2rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                    title="Tải lại danh sách mới nhất"
                  >
                    🔄 Làm mới
                  </button>
                </div>
              </div>

              {filteredJobs.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                  <p style={{ margin: 0, fontSize: '0.9rem' }}>
                    {jobs.length === 0 ? 'Chưa có tiến trình cào nào được thực hiện.' : 'Không tìm thấy tiến trình nào phù hợp với điều kiện tìm kiếm/lọc.'}
                  </p>
                </div>
              ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  {/* Table wrapper with sticky column and sticky header */}
                  <div 
                    className="table-container" 
                    style={{ 
                      flex: 1, 
                      minHeight: 0, 
                      overflow: 'auto', 
                      border: '1px solid var(--border-color)', 
                      borderRadius: '8px', 
                      position: 'relative' 
                    }}
                  >
                    <table className="table" style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0 }}>
                      <thead>
                        <tr>
                          <th style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'var(--bg-tertiary)', width: '50px', textAlign: 'center', padding: '0.6rem 0.4rem' }}>ID</th>
                          <th style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'var(--bg-tertiary)', width: '50px', textAlign: 'center', padding: '0.6rem 0.4rem' }}>Kênh</th>
                          <th style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'var(--bg-tertiary)', width: '26%', textAlign: 'left', padding: '0.6rem 0.6rem' }}>Mục tiêu</th>
                          <th style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'var(--bg-tertiary)', width: '20%', textAlign: 'left', padding: '0.6rem 0.6rem' }}>Tập Lead Tag</th>
                          <th style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'var(--bg-tertiary)', width: '85px', textAlign: 'center', padding: '0.6rem 0.4rem' }}>Thu thập</th>
                          <th style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'var(--bg-tertiary)', width: '115px', textAlign: 'center', padding: '0.6rem 0.4rem' }}>Trạng thái</th>
                          <th style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'var(--bg-tertiary)', width: '110px', textAlign: 'center', padding: '0.6rem 0.4rem' }}>Ngày tạo</th>
                          <th style={{ position: 'sticky', top: 0, right: 0, zIndex: 20, backgroundColor: 'var(--bg-tertiary)', width: '185px', textAlign: 'right', padding: '0.6rem 0.75rem', boxShadow: '-4px 0 8px rgba(0,0,0,0.35)' }}>Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedJobs.map(job => {
                          const { time, date } = formatDateTime(job.created_at);
                          const isProcessing = job.status === 'processing' || job.status === 'pending';
                          const isCompleted = job.status === 'completed';
                          const isStopped = job.status === 'stopped';
                          const isFailed = job.status === 'failed' || job.status === 'error';

                          return (
                            <tr key={job.id} style={{ transition: 'background-color 0.15s ease' }}>
                              <td className="font-mono" style={{ fontSize: '0.78rem', textAlign: 'center', color: 'var(--text-secondary)', padding: '0.5rem 0.4rem' }}>
                                #{job.id}
                              </td>
                              <td style={{ textAlign: 'center', padding: '0.5rem 0.4rem' }}>
                                <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} title={`Nền tảng: ${(job.platform || '').toUpperCase()}`}>
                                  {job.platform === 'telegram' ? (
                                    <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '26px', borderRadius: '50%', background: 'rgba(34, 158, 217, 0.15)', border: '1px solid rgba(34, 158, 217, 0.35)' }}>
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="#229ED9">
                                        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18.895-1.042 4.964-1.477 7.288-.184.982-.544 1.311-.892 1.343-.758.07-1.332-.5-2.066-.981-1.15-.752-1.799-1.22-2.915-1.955-1.29-.85-.454-1.317.281-2.081.192-.2 3.527-3.233 3.591-3.509.008-.035.015-.164-.062-.232-.077-.068-.19-.045-.272-.026-.116.026-1.96 1.246-5.534 3.659-.523.36-1.002.537-1.436.527-.478-.01-1.398-.27-2.083-.493-.84-.274-1.509-.419-1.451-.885.03-.243.366-.492 1.008-.748 3.948-1.72 6.582-2.854 7.901-3.402 3.766-1.565 4.549-1.837 5.06-1.846.112-.002.364.026.527.158.138.112.176.262.195.367.019.106.014.338-.005.51z"/>
                                      </svg>
                                    </div>
                                  ) : job.platform === 'facebook' ? (
                                    <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '26px', borderRadius: '50%', background: 'rgba(24, 119, 242, 0.15)', border: '1px solid rgba(24, 119, 242, 0.35)' }}>
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="#1877F2">
                                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                                      </svg>
                                    </div>
                                  ) : (
                                    <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '26px', borderRadius: '50%', background: 'rgba(0, 178, 255, 0.15)', border: '1px solid rgba(0, 178, 255, 0.35)' }}>
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="#00B2FF">
                                        <path d="M12 0C5.373 0 0 4.974 0 11.111c0 3.498 1.744 6.617 4.471 8.652v4.237l4.086-2.242c1.09.301 2.247.464 3.443.464 6.627 0 12-4.974 12-11.111S18.627 0 12 0zm1.193 14.963l-3.056-3.259-5.963 3.259 6.557-6.963 3.13 3.259 5.889-3.259-6.557 6.963z"/>
                                      </svg>
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0.5rem 0.6rem' }}>
                                <span 
                                  title={job.target_group} 
                                  style={{ 
                                    fontSize: '0.82rem', 
                                    fontWeight: 600, 
                                    color: 'var(--text-primary)', 
                                    overflow: 'hidden', 
                                    textOverflow: 'ellipsis', 
                                    whiteSpace: 'nowrap',
                                    display: 'block'
                                  }}
                                >
                                  {formatTargetGroup(job.target_group)}
                                </span>
                              </td>
                              <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0.5rem 0.6rem' }}>
                                <span 
                                  title={job.custom_tag || 'Mặc định'}
                                  style={{ 
                                    fontSize: '0.78rem', 
                                    color: 'var(--color-primary-hover)', 
                                    fontWeight: 600, 
                                    overflow: 'hidden', 
                                    textOverflow: 'ellipsis', 
                                    whiteSpace: 'nowrap',
                                    display: 'block' 
                                  }} 
                                >
                                  📁 {job.custom_tag || 'Mặc định'}
                                </span>
                              </td>
                              <td style={{ textAlign: 'center', padding: '0.5rem 0.4rem' }}>
                                <strong style={{ fontSize: '0.82rem', color: job.total_count > 0 ? 'var(--color-success)' : 'var(--text-secondary)' }}>
                                  {job.total_count.toLocaleString()}
                                </strong>
                              </td>
                              <td style={{ textAlign: 'center', padding: '0.5rem 0.4rem' }}>
                                <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem' }}>
                                  <span className={"badge " + (isCompleted ? 'badge-live' : isProcessing ? 'badge-checkpoint' : isStopped ? 'badge-checkpoint' : 'badge-die')} style={{ fontSize: '0.65rem', backgroundColor: isStopped ? 'rgba(234, 88, 12, 0.15)' : undefined, color: isStopped ? '#fb923c' : undefined, borderColor: isStopped ? 'rgba(234, 88, 12, 0.4)' : undefined }}>
                                    {isProcessing ? '⚡ ĐANG CHẠY' : isCompleted ? '✓ COMPLETED' : isStopped ? '⏹ ĐÃ DỪNG' : '✕ FAILED'}
                                  </span>
                                  {(isFailed || isStopped) && job.error_msg && (
                                    <button
                                      type="button"
                                      onClick={() => setActiveErrorJob(job)}
                                      style={{
                                        background: 'rgba(248, 113, 113, 0.15)',
                                        border: '1px solid rgba(248, 113, 113, 0.3)',
                                        borderRadius: '4px',
                                        color: '#f87171',
                                        cursor: 'pointer',
                                        fontSize: '0.65rem',
                                        padding: '0.05rem 0.3rem',
                                        lineHeight: 1.2
                                      }}
                                      title="Xem chi tiết"
                                    >
                                      ⚠️ Chi tiết
                                    </button>
                                  )}
                                </div>
                              </td>
                              <td style={{ textAlign: 'center', padding: '0.5rem 0.4rem' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', fontSize: '0.75rem', lineHeight: '1.2', alignItems: 'center' }}>
                                  <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{time}</span>
                                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>{date}</span>
                                </div>
                              </td>
                              <td style={{ position: 'sticky', right: 0, zIndex: 5, backgroundColor: 'var(--bg-secondary)', padding: '0.5rem 0.75rem', boxShadow: '-4px 0 8px rgba(0,0,0,0.35)', textAlign: 'right' }}>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.3rem', alignItems: 'center' }}>
                                  {isProcessing ? (
                                    <button
                                      type="button"
                                      onClick={() => handleStopJob(job.id)}
                                      className="btn btn-danger"
                                      style={{ fontSize: '0.7rem', padding: '0.2rem 0.45rem', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.2rem', backgroundColor: '#dc2626', borderColor: '#b91c1c' }}
                                      disabled={submitting}
                                      title="Dừng đột ngột tiến trình cào này"
                                    >
                                      ⏹️ Dừng
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleReRunJob(job.id)}
                                      className="btn btn-secondary"
                                      style={{ fontSize: '0.7rem', padding: '0.2rem 0.45rem', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                                      disabled={submitting}
                                      title="Chạy lại tiến trình cào này"
                                    >
                                      🔄 Re-run
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => setSelectedJobId(job.id)}
                                    className="btn btn-primary"
                                    style={{ fontSize: '0.7rem', padding: '0.2rem 0.45rem', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                                    title="Xem danh sách Leads đệm đã cào được"
                                  >
                                    👁️ Xem
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteJob(job.id)}
                                    className="btn btn-danger"
                                    style={{ fontSize: '0.7rem', padding: '0.2rem 0.4rem', whiteSpace: 'nowrap' }}
                                    disabled={submitting}
                                    title="Xóa tiến trình cào này"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination Footer */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', paddingTop: '0.6rem', borderTop: '1px solid var(--border-color)', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        Trang <strong>{historyPage + 1}</strong> / {totalHistoryPages} ({filteredJobs.length} tiến trình)
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        <span>Hiển thị:</span>
                        <select
                          className="select"
                          value={pageSize}
                          onChange={(e) => { setPageSize(Number(e.target.value)); setHistoryPage(0); }}
                          style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem', height: '1.7rem' }}
                        >
                          <option value={8}>8 dòng</option>
                          <option value={10}>10 dòng</option>
                          <option value={20}>20 dòng</option>
                          <option value={50}>50 dòng</option>
                        </select>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      <button
                        type="button"
                        onClick={() => setHistoryPage(0)}
                        disabled={historyPage === 0}
                        className="btn btn-secondary"
                        style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
                        title="Về trang đầu"
                      >
                        « Đầu
                      </button>
                      <button
                        type="button"
                        onClick={() => setHistoryPage(prev => Math.max(0, prev - 1))}
                        disabled={historyPage === 0}
                        className="btn btn-secondary"
                        style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem' }}
                      >
                        ◄ Trước
                      </button>
                      <button
                        type="button"
                        onClick={() => setHistoryPage(prev => Math.min(totalHistoryPages - 1, prev + 1))}
                        disabled={historyPage >= totalHistoryPages - 1}
                        className="btn btn-secondary"
                        style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem' }}
                      >
                        Sau ►
                      </button>
                      <button
                        type="button"
                        onClick={() => setHistoryPage(totalHistoryPages - 1)}
                        disabled={historyPage >= totalHistoryPages - 1}
                        className="btn btn-secondary"
                        style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
                        title="Đến trang cuối"
                      >
                        Cuối »
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Error Detail Modal */}
              {activeErrorJob && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1200, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '1rem' }}>
                  <div className="card" style={{ width: '100%', maxWidth: '620px', backgroundColor: 'var(--bg-secondary)', padding: '1.5rem', borderRadius: '10px', border: '1px solid var(--color-danger)', boxShadow: '0 8px 32px rgba(248,81,73,0.3)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                      <h4 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        ⚠️ Chi Tiết Lỗi Tiến Trình Cào #{activeErrorJob.id}
                      </h4>
                      <button type="button" onClick={() => setActiveErrorJob(null)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
                    </div>

                    <div style={{ marginBottom: '1rem', fontSize: '0.82rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      <div><strong>Mục tiêu:</strong> <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{activeErrorJob.target_group}</span></div>
                      <div><strong>Nền tảng:</strong> <span style={{ textTransform: 'uppercase', color: 'var(--text-primary)' }}>{activeErrorJob.platform}</span></div>
                      <div><strong>Thời gian:</strong> <span>{activeErrorJob.created_at ? new Date(activeErrorJob.created_at).toLocaleString('vi-VN') : '--'}</span></div>
                    </div>

                    <div style={{ backgroundColor: 'rgba(0,0,0,0.5)', padding: '0.85rem', borderRadius: '6px', border: '1px solid rgba(248,81,73,0.3)', color: '#fca5a5', fontSize: '0.8rem', fontFamily: 'monospace', maxHeight: '220px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: '1.25rem' }}>
                      {activeErrorJob.error_msg || 'Không có chi tiết lỗi nào được ghi nhận từ hệ thống.'}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                      <button
                        type="button"
                        onClick={() => {
                          handleReRunJob(activeErrorJob.id);
                          setActiveErrorJob(null);
                        }}
                        className="btn btn-primary"
                        style={{ fontSize: '0.8rem', padding: '0.4rem 1rem' }}
                      >
                        🔄 Chạy lại tiến trình
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveErrorJob(null)}
                        className="btn btn-secondary"
                        style={{ fontSize: '0.8rem', padding: '0.4rem 1rem' }}
                      >
                        Đóng
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Inspect Scraped Leads Buffer Drawer / Modal */}
              {selectedJobId && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1100, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '1rem' }}>
                  <div className="card" style={{ width: '100%', maxWidth: '700px', maxHeight: '80vh', backgroundColor: 'var(--bg-secondary)', padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                      <h4 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                        👁️ Danh sách Leads Thu Thập Đệm (#Job {selectedJobId}) - {scrapedLeads.length} mục
                      </h4>
                      <button type="button" onClick={() => setSelectedJobId(null)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
                    </div>

                    <div style={{ flexGrow: 1, overflowY: 'auto', marginBottom: '1rem' }}>
                      {loadingLeads ? (
                        <p style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem' }}>Đang tải danh sách...</p>
                      ) : scrapedLeads.length === 0 ? (
                        <p style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem' }}>Chưa có dòng dữ liệu nào cào thành công.</p>
                      ) : (
                        <div className="table-container" style={{ maxHeight: '350px' }}>
                          <table className="table mini-table">
                            <thead>
                              <tr>
                                <th>UID / Username</th>
                                <th>Tên hiển thị</th>
                              </tr>
                            </thead>
                            <tbody>
                              {scrapedLeads.map(l => (
                                <tr key={l.id}>
                                  <td className="font-mono" style={{ fontSize: '0.78rem' }}>{l.uid}</td>
                                  <td style={{ fontSize: '0.78rem' }}>{l.display_name || '--'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button type="button" onClick={() => setSelectedJobId(null)} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.4rem 1.25rem' }}>
                        Đóng
                      </button>
                    </div>
                  </div>
                </div>
              )}

            </div>
          )}

        </div>
      </div>
    </div>
  );
}
