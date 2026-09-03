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

interface ScrapeModalProps {
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
}

interface ScrapedLead {
  id: number;
  uid: string;
  display_name: string;
  avatar_url: string;
}

export default function ScrapeModal({ isOpen, onClose, accounts, campaigns, onSuccess }: ScrapeModalProps) {
  const [targetGroup, setTargetGroup] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [maxLimit, setMaxLimit] = useState<number>(5000);
  const [autoImport, setAutoImport] = useState(false);
  const [targetCampaignId, setTargetCampaignId] = useState<string>('');
  const [scrapeType, setScrapeType] = useState<'members' | 'chat_history' | 'hybrid' | 'kol_followers' | 'post_commenters' | 'multi_tier'>('multi_tier');
  const [customTag, setCustomTag] = useState('');
  
  const [activeTab, setActiveTab] = useState<'create' | 'history'>('create');
  
  // State for jobs and details
  const [jobs, setJobs] = useState<ScrapeJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [scrapedLeads, setScrapedLeads] = useState<ScrapedLead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);

  const [activeErrorDetail, setActiveErrorDetail] = useState<string | null>(null);

  // Status & Alerts
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [selectedPlatform, setSelectedPlatform] = useState<'telegram' | 'facebook' | 'messenger' | 'whatsapp'>('facebook');
  const [internalAccounts, setInternalAccounts] = useState<Account[]>([]);

  const fetchAccounts = async () => {
    try {
      const res = await fetch('/api/accounts');
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setInternalAccounts(data.data);
      }
    } catch (err) {
      console.error('Error fetching accounts:', err);
    }
  };

  const allAccounts = internalAccounts.length > 0 ? internalAccounts : (accounts || []);

  // Filter accounts to show only LIVE scraper accounts for the selected platform
  const scraperAccounts = allAccounts.filter(a => {
    const targetPlatform = selectedPlatform === 'messenger' ? 'facebook' : selectedPlatform;
    const plat = (a.platform || '').toLowerCase().trim();
    const stat = (a.status || '').toLowerCase().trim();
    return plat === targetPlatform.toLowerCase() && (stat === 'live' || stat === 'ready' || stat === 'active');
  });

  // Load history jobs when tab changes or modal opens
  const fetchJobs = async () => {
    try {
      const res = await fetch('/api/spam/scrape');
      const data = await res.json();
      if (data.success) {
        setJobs(data.data || []);
      }
    } catch (err) {
      console.error('Error fetching scrape jobs:', err);
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
        setSelectedAccountId(scraperAccounts[0].id.toString());
      } else {
        setSelectedAccountId('');
      }
    }
  }, [isOpen, activeTab, selectedPlatform, internalAccounts, accounts]);

  useEffect(() => {
    if (scrapeType === 'post_commenters') {
      setMaxLimit(500);
    } else {
      setMaxLimit(5000);
    }
  }, [scrapeType]);

  // Periodic refresh when there are processing jobs
  useEffect(() => {
    let interval: NodeJS.Timeout;
    const hasActiveJob = jobs.some(j => j.status === 'pending' || j.status === 'processing');
    
    if (isOpen && hasActiveJob) {
      interval = setInterval(() => {
        fetchJobs();
      }, 5000); // Check every 5s
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isOpen, jobs]);

  // Load scraped leads when a job is selected
  useEffect(() => {
    const fetchLeads = async () => {
      if (!selectedJobId) return;
      setLoadingLeads(true);
      try {
        const res = await fetch(`/api/spam/scrape?jobId=${selectedJobId}`);
        const data = await res.json();
        if (data.success) {
          setScrapedLeads(data.data || []);
        }
      } catch (err) {
        console.error('Error fetching scraped leads:', err);
      } finally {
        setLoadingLeads(false);
      }
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

    if (!selectedAccountId) {
      setError(`Vui lòng chọn tài khoản ${selectedPlatform === 'telegram' ? 'Telegram' : 'Facebook'} hoạt động tốt để quét.`);
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch('/api/spam/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: parseInt(selectedAccountId, 10),
          targetGroup: targetGroup.trim(),
          maxLimit,
          autoImport,
          targetCampaignId: autoImport ? targetCampaignId : null,
          scrapeType,
          customTag: customTag.trim() || null,
          platform: selectedPlatform
        })
      });

      const data = await res.json();
      if (data.success) {
        setSuccess('Đã thêm tác vụ quét nhóm vào hàng đợi thành công!');
        setTargetGroup('');
        setCustomTag('');
        fetchJobs();
        setActiveTab('history');
        onSuccess();
      } else {
        setError(data.error || 'Đã có lỗi xảy ra.');
      }
    } catch (err: any) {
      setError('Lỗi kết nối máy chủ.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleManualImport = async (jobId: number, campaignId: string) => {
    if (!campaignId) {
      alert('Vui lòng chọn chiến dịch để nạp leads.');
      return;
    }

    try {
      setLoadingLeads(true);
      // Fetch leads for this job
      const resLeads = await fetch(`/api/spam/scrape?jobId=${jobId}`);
      const dataLeads = await resLeads.json();
      if (!dataLeads.success || !dataLeads.data || dataLeads.data.length === 0) {
        alert('Không tìm thấy thành viên nào để nạp.');
        return;
      }

      const job = jobs.find((j: any) => j.id === jobId);

      // Convert and send to /api/spam/leads POST API
      const rawText = dataLeads.data.map((lead: ScrapedLead) => {
        const isNumeric = /^\d+$/.test(lead.uid);
        if (isNumeric) return lead.uid;

        // Nếu là job Telegram, nạp username có ký tự @ ở đầu
        if (job && job.platform === 'telegram') {
          return lead.uid.startsWith('@') ? lead.uid : `@${lead.uid}`;
        }

        // Nếu là Facebook hoặc Messenger, nạp link profile facebook để backend nhận diện platform là facebook
        if (job && (job.platform === 'facebook' || job.platform === 'messenger')) {
          return `https://www.facebook.com/${lead.uid}`;
        }

        return lead.uid;
      }).join('\n');
      
      let source = undefined;
      if (job) {
        const targetClean = job.target_group.split('/').filter(Boolean).pop() || 'Target';
        source = job.custom_tag || `KOL_${targetClean}`;
      }

      const resImport = await fetch('/api/spam/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText, source })
      });

      const dataImport = await resImport.json();
      if (dataImport.success) {
        alert(`Nạp thành công ${dataLeads.data.length} thành viên vào danh sách Leads!`);
        setSelectedJobId(null);
        fetchJobs();
        onSuccess();
      } else {
        alert(`Lỗi: ${dataImport.error}`);
      }
    } catch (e: any) {
      alert('Gặp lỗi khi nạp leads.');
    } finally {
      setLoadingLeads(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '650px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="modal-header">
          <h3 className="modal-title">
            <svg style={{ width: '20px', height: '20px', fill: 'currentColor' }} viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
            </svg>
            Quét Thành Viên Nhóm
          </h3>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>

        {/* Tabs */}
        <div className="modal-tabs">
          <button 
            className={`tab-btn ${activeTab === 'create' ? 'active' : ''}`}
            onClick={() => { setActiveTab('create'); setSelectedJobId(null); }}
          >
            Tạo tác vụ quét
          </button>
          <button 
            className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => fetchJobs().then(() => setActiveTab('history'))}
          >
            Lịch sử quét ({jobs.length})
          </button>
        </div>

        <div className="modal-body" style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
          {error && <div className="alert alert-danger">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}

          {activeTab === 'create' ? (
            <form onSubmit={handleSubmit} className="scrape-form">
              <div className="form-group">
                <label className="form-label">Chọn nền tảng:</label>
                <select 
                  className="form-input"
                  value={selectedPlatform}
                  onChange={(e) => setSelectedPlatform(e.target.value as any)}
                  disabled={submitting}
                >
                  <option value="telegram">Telegram</option>
                  <option value="whatsapp">WhatsApp Group</option>
                  <option value="facebook">Facebook Group</option>
                  <option value="messenger">Messenger Group</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">
                  {selectedPlatform === 'telegram' 
                    ? 'Link hoặc Username nhóm Telegram:' 
                    : selectedPlatform === 'whatsapp'
                      ? 'Link mời nhóm (chat.whatsapp.com/...) hoặc Tên nhóm:'
                      : selectedPlatform === 'facebook'
                        ? 'Link Fanpage / Profile hoặc UID Nhóm Facebook:'
                        : 'Link hoặc Thread ID nhóm Messenger:'}
                </label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder={selectedPlatform === 'telegram' 
                    ? 'Ví dụ: https://t.me/durov hoặc @durov' 
                    : selectedPlatform === 'whatsapp'
                      ? 'Ví dụ: https://chat.whatsapp.com/InviteCode123 hoặc Tên nhóm'
                      : selectedPlatform === 'facebook'
                        ? 'Ví dụ: https://facebook.com/tintucUSstock hoặc https://facebook.com/groups/123456789'
                        : 'Ví dụ: https://www.facebook.com/messages/t/123456789 hoặc 123456789'} 
                  value={targetGroup}
                  onChange={(e) => setTargetGroup(e.target.value)}
                  disabled={submitting}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  Tài khoản chạy quét (Yêu cầu LIVE):
                </label>
                {scraperAccounts.length === 0 ? (
                  <div className="alert alert-warning" style={{ fontSize: '0.85rem', padding: '0.5rem' }}>
                    ⚠️ Không có tài khoản {selectedPlatform === 'telegram' ? 'Telegram' : selectedPlatform === 'whatsapp' ? 'WhatsApp' : 'Facebook'} hoạt động (LIVE). Vui lòng thêm tài khoản ở trang chủ và đăng nhập trước.
                  </div>
                ) : (
                  <select 
                    className="form-input"
                    value={selectedAccountId}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
                    disabled={submitting}
                  >
                    {scraperAccounts.map(acc => (
                      <option key={acc.id} value={acc.id}>
                        @{acc.username} (LIVE)
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {selectedPlatform === 'telegram' ? (
                <div className="form-group">
                  <label className="form-label">Kiểu quét:</label>
                  <select 
                    className="form-input"
                    value={scrapeType}
                    onChange={(e) => setScrapeType(e.target.value as any)}
                    disabled={submitting}
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
                  padding: '0.65rem 0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  marginBottom: '0.25rem'
                }}>
                  <span style={{ fontSize: '1.3rem' }}>🌟</span>
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#38bdf8' }}>
                      Chế độ Quét Toàn Diện Tối Đa (360° All-in-One Engine)
                    </div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                      Tự động gom tất cả: Người theo dõi + Cảm xúc (Like/Love/Care) + Bình luận & Trả lời + Nhóm liên kết Bio.
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">
                    {scrapeType === 'post_commenters' 
                      ? 'Số bài viết gần nhất cần quét:' 
                      : scrapeType === 'chat_history'
                        ? 'Giới hạn quét tin (Mặc định 2000):'
                        : 'Giới hạn cào (Mặc định 2000):'}
                  </label>
                  <input 
                    type="number" 
                    className="form-input" 
                    min="1" 
                    max="50000"
                    value={maxLimit}
                    placeholder={scrapeType === 'post_commenters' ? 'Mặc định: 50 bài post' : 'Mặc định: 2000'}
                    onChange={(e) => setMaxLimit(parseInt(e.target.value, 10) || 0)}
                    disabled={submitting}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Tên KOL / Fanpage / Nhãn nguồn (Source Tag):</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="VD: KOL_NguyenVanA, Fanpage_XYZ..."
                    value={customTag}
                    onChange={(e) => setCustomTag(e.target.value)}
                    disabled={submitting}
                  />
                </div>
              </div>

              {/* Live Account & Scraping Speed Estimator Widget */}
              {maxLimit > 0 && (
                <div className="estimator-box" style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '8px',
                  padding: '12px 16px',
                  marginBottom: '16px',
                  fontSize: '0.85rem'
                }}>
                  {(() => {
                    const currentLive = scraperAccounts.length || 1;
                    const recommendedAccounts = maxLimit <= 500 ? 1 : maxLimit <= 2000 ? 4 : maxLimit <= 5000 ? 8 : 15;
                    // Safe scraping pace: ~400 leads/hour per live account
                    const hoursSingle = (maxLimit / 400).toFixed(1);
                    const hoursRecommended = (maxLimit / (400 * recommendedAccounts)).toFixed(1);
                    const hoursCurrent = (maxLimit / (400 * currentLive)).toFixed(1);

                    return (
                      <div>
                        <div style={{ fontWeight: 600, color: '#38bdf8', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>📊 Ước tính hiệu năng & Tài khoản khuyến nghị:</span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', color: '#cbd5e1' }}>
                          <div>
                            • Khuyên dùng: <strong style={{ color: '#4ade80' }}>{recommendedAccounts} tài khoản Live</strong>
                          </div>
                          <div>
                            • Thời gian tối ưu: <strong style={{ color: '#4ade80' }}>~{hoursRecommended} giờ</strong> (chạy song song)
                          </div>
                          <div>
                            • Tài khoản hiện có: <strong>{scraperAccounts.length} Live</strong>
                          </div>
                          <div>
                            • Thời gian dự kiến: <strong style={{ color: currentLive < recommendedAccounts ? '#f59e0b' : '#38bdf8' }}>~{hoursCurrent} giờ</strong>
                          </div>
                        </div>

                        {currentLive < recommendedAccounts && maxLimit >= 1000 && (
                          <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed rgba(255,255,255,0.1)', color: '#fbbf24', fontSize: '0.8rem' }}>
                            💡 <strong>Mẹo tăng tốc ⚡:</strong> Quét {maxLimit.toLocaleString()} leads với {currentLive} nick hiện tại sẽ mất ~{hoursCurrent}h để né checkpoint. Bổ sung thêm <strong style={{ textDecoration: 'underline' }}>{recommendedAccounts - currentLive} tài khoản Live</strong> để rút ngắn thời gian xuống chỉ còn ~{hoursRecommended}h!
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              <div className="form-group checkbox-group">
                <label className="checkbox-label">
                  <input 
                    type="checkbox" 
                    checked={autoImport}
                    onChange={(e) => setAutoImport(e.target.checked)}
                    disabled={submitting}
                  />
                  <span>Tự động nạp thành viên quét được vào chiến dịch (Auto-Import)</span>
                </label>
              </div>

              {autoImport && (
                <div className="form-group fade-in">
                  <label className="form-label">Chọn chiến dịch để nạp leads tự động:</label>
                  <select 
                    className="form-input"
                    value={targetCampaignId}
                    onChange={(e) => setTargetCampaignId(e.target.value)}
                    disabled={submitting}
                    required={autoImport}
                  >
                    <option value="">-- Chọn chiến dịch / Nguồn --</option>
                    {campaigns && campaigns.length > 0 ? (
                      campaigns.map(c => (
                        <option key={c.campaign_id} value={c.campaign_id}>
                          {c.campaign_id}
                        </option>
                      ))
                    ) : (
                      <option value="default_scraped">Mặc định (default_scraped)</option>
                    )}
                  </select>
                </div>
              )}

              <div className="modal-footer" style={{ padding: '1rem 0 0 0', border: 'none' }}>
                <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>Hủy</button>
                 <button type="submit" className="btn btn-gradient" disabled={submitting || scraperAccounts.length === 0}>
                  {submitting ? 'Đang gửi yêu cầu...' : '🚀 Bắt đầu quét'}
                </button>
              </div>
            </form>
          ) : (
            // Tab Lịch sử quét
            <div className="history-section">
              {selectedJobId ? (
                // Chi tiết của 1 job cào
                <div className="leads-detail-view">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setSelectedJobId(null)}>
                      ← Quay lại lịch sử
                    </button>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <select 
                        id="manualCampaignSelect"
                        className="form-input" 
                        style={{ padding: '0.25rem 0.5rem', width: '200px', fontSize: '0.85rem' }}
                        defaultValue=""
                      >
                        <option value="">-- Chọn chiến dịch đích --</option>
                        {campaigns.map(c => (
                          <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_id}</option>
                        ))}
                        <option value="manual_imported">Nạp thủ công (manual_imported)</option>
                      </select>
                      <button 
                        className="btn btn-gradient btn-sm"
                        disabled={loadingLeads}
                        onClick={() => {
                          const select = document.getElementById('manualCampaignSelect') as HTMLSelectElement;
                          handleManualImport(selectedJobId, select.value);
                        }}
                      >
                        Nạp vào Leads
                      </button>
                    </div>
                  </div>

                  <h4>Danh sách thành viên quét được ({scrapedLeads.length})</h4>
                  
                  {loadingLeads ? (
                    <div style={{ textAlign: 'center', padding: '2rem' }}>Đang tải dữ liệu...</div>
                  ) : scrapedLeads.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                      Không tìm thấy thành viên nào. Tác vụ có thể chưa hoàn thành hoặc bị lỗi.
                    </div>
                  ) : (
                    <div className="leads-grid">
                      {scrapedLeads.map(lead => (
                        <div key={lead.id} className="lead-card">
                          <div className="lead-avatar">
                            {lead.avatar_url ? (
                              <img src={lead.avatar_url} alt={lead.display_name} />
                            ) : (
                              <div className="avatar-placeholder">{lead.display_name[0]?.toUpperCase() || 'U'}</div>
                            )}
                          </div>
                          <div className="lead-info">
                            <div className="lead-name">{lead.display_name}</div>
                            <div className="lead-uid">@{lead.uid}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                // Danh sách jobs
                 <div className="jobs-list">
                  {activeErrorDetail && (
                    <div className="alert alert-danger fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong style={{ fontSize: '0.85rem' }}>Chi tiết lỗi tác vụ:</strong>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button 
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', height: 'auto', background: 'rgba(255,255,255,0.1)', cursor: 'pointer' }}
                            onClick={() => {
                              navigator.clipboard.writeText(activeErrorDetail);
                              alert('Đã sao chép chi tiết thông báo lỗi vào clipboard!');
                            }}
                          >
                            📋 Sao chép lỗi
                          </button>
                          <button 
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', height: 'auto', background: 'rgba(255,255,255,0.1)', cursor: 'pointer' }}
                            onClick={() => setActiveErrorDetail(null)}
                          >
                            Đóng ×
                          </button>
                        </div>
                      </div>
                      <textarea 
                        readOnly 
                        value={activeErrorDetail} 
                        style={{ 
                          width: '100%', 
                          height: '110px', 
                          fontSize: '0.75rem', 
                          fontFamily: 'monospace', 
                          background: 'rgba(0,0,0,0.3)', 
                          border: '1px solid rgba(255,255,255,0.1)', 
                          borderRadius: '4px', 
                          color: '#ff6b6b', 
                          padding: '0.5rem',
                          resize: 'none',
                          outline: 'none'
                        }}
                      />
                    </div>
                  )}

                  {jobs.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                      Chưa có tác vụ quét nào được tạo.
                    </div>
                  ) : (
                    <table className="jobs-table">
                      <thead>
                        <tr>
                          <th>Nhóm</th>
                          <th>Tự động nạp</th>
                          <th>Kết quả</th>
                          <th>Trạng thái</th>
                          <th>Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {jobs.map(job => (
                          <tr key={job.id}>
                            <td className="cell-target">{job.target_group}</td>
                            <td>{job.auto_import ? `✅ (${job.target_campaign_id})` : '❌'}</td>
                            <td>{job.total_count > 0 ? `${job.total_count} mem` : '-'}</td>
                            <td>
                              <span className={`status-badge status-${job.status}`}>
                                {job.status === 'pending' && 'Đang chờ'}
                                {job.status === 'processing' && 'Đang quét...'}
                                {job.status === 'completed' && 'Hoàn thành'}
                                {job.status === 'failed' && 'Lỗi'}
                              </span>
                            </td>
                            <td>
                              {job.status === 'completed' && (
                                <button 
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => setSelectedJobId(job.id)}
                                >
                                  Xem leads
                                </button>
                              )}
                              {job.status === 'failed' && (
                                <button 
                                  className="btn btn-secondary btn-sm"
                                  title="Xem chi tiết lỗi"
                                  onClick={() => setActiveErrorDetail(job.error_msg)}
                                >
                                  Xem lỗi
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <style jsx>{`
          .modal-tabs {
            display: flex;
            border-bottom: 1px solid var(--border-color);
            padding: 0 1.5rem;
          }
          .tab-btn {
            background: transparent;
            border: none;
            border-bottom: 2px solid transparent;
            color: var(--text-secondary);
            padding: 0.5rem 1.25rem;
            cursor: pointer;
            font-weight: 500;
            font-size: 0.85rem;
            transition: all 0.2s;
          }
          .tab-btn.active {
            border-bottom-color: var(--color-primary);
            color: var(--text-primary);
          }
          .modal-header {
            padding: 0.75rem 1.25rem !important;
          }
          .modal-body {
            padding: 1rem 1.25rem !important;
          }
          .scrape-form {
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
            flex: none !important;
            overflow: visible !important;
          }
          .form-group {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
          }
          .form-row {
            display: grid;
            grid-template-columns: 1fr;
            gap: 0.75rem;
          }
          @media (min-width: 500px) {
            .form-row {
              grid-template-columns: 1fr 1fr;
            }
          }
          .form-label {
            font-size: 0.82rem;
            font-weight: 600;
            color: var(--text-secondary);
            margin-bottom: 0.15rem;
          }
          .form-input {
            background: rgba(13, 17, 23, 0.6);
            border: 1px solid var(--border-color);
            color: var(--text-primary);
            border-radius: 8px;
            padding: 0.6rem 0.75rem;
            font-size: 0.9rem;
            outline: none;
            transition: all 0.2s;
          }
          .form-input:focus {
            border-color: var(--color-primary);
            box-shadow: 0 0 8px rgba(47, 129, 247, 0.2);
          }
          .checkbox-group {
            margin: 0.5rem 0;
          }
          .checkbox-label {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            cursor: pointer;
            font-size: 0.85rem;
            color: var(--text-secondary);
          }
          .checkbox-label input {
            cursor: pointer;
          }
          .alert {
            padding: 0.75rem 1rem;
            border-radius: 8px;
            font-size: 0.85rem;
          }
          .alert-danger {
            background: rgba(248, 81, 73, 0.15);
            border: 1px solid rgba(248, 81, 73, 0.3);
            color: var(--color-danger);
          }
          .alert-success {
            background: rgba(63, 185, 80, 0.15);
            border: 1px solid rgba(63, 185, 80, 0.3);
            color: var(--color-success);
          }
          .alert-warning {
            background: rgba(210, 153, 34, 0.15);
            border: 1px solid rgba(210, 153, 34, 0.3);
            color: var(--color-warning);
          }
          .btn-sm {
            padding: 0.25rem 0.5rem;
            font-size: 0.8rem;
          }
          
          /* Jobs table styles */
          .jobs-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.85rem;
          }
          .jobs-table th, .jobs-table td {
            padding: 0.6rem 0.75rem;
            text-align: left;
            border-bottom: 1px solid var(--border-color);
          }
          .jobs-table th {
            font-weight: 600;
            color: var(--text-secondary);
            background: var(--bg-tertiary);
          }
          .cell-target {
            max-width: 180px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .status-badge {
            display: inline-block;
            padding: 0.2rem 0.4rem;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: 500;
          }
          .status-pending {
            background: rgba(139, 148, 158, 0.15);
            color: var(--text-secondary);
            border: 1px solid rgba(139, 148, 158, 0.3);
          }
          .status-processing {
            background: rgba(47, 129, 247, 0.15);
            color: var(--color-primary);
            border: 1px solid rgba(47, 129, 247, 0.3);
          }
          .status-completed {
            background: rgba(63, 185, 80, 0.15);
            color: var(--color-success);
            border: 1px solid rgba(63, 185, 80, 0.3);
          }
          .status-failed {
            background: rgba(248, 81, 73, 0.15);
            color: var(--color-danger);
            border: 1px solid rgba(248, 81, 73, 0.3);
          }
          
          /* Leads grid detail styles */
          .leads-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
            gap: 0.75rem;
            margin-top: 1rem;
            max-height: 400px;
            overflow-y: auto;
          }
          .lead-card {
            background: var(--bg-card);
            border: 1px solid var(--border-subtle);
            border-radius: 8px;
            padding: 0.5rem;
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
            gap: 0.5rem;
          }
          .lead-avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            overflow: hidden;
          }
          .lead-avatar img {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }
          .avatar-placeholder {
            width: 100%;
            height: 100%;
            background: var(--bg-tertiary);
            color: var(--text-primary);
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            font-size: 0.95rem;
          }
          .lead-info {
            width: 100%;
            overflow: hidden;
          }
          .lead-name {
            font-size: 0.8rem;
            font-weight: 600;
            color: var(--text-primary);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .lead-uid {
            font-size: 0.75rem;
            color: var(--color-primary-hover);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .fade-in {
            animation: fadeIn 0.3s ease-out;
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-5px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    </div>
  );
}
