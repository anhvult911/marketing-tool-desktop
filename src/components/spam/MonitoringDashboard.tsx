import React from 'react';

interface Job {
  id: number;
  username: string | null;
  type: string;
  target_url: string | null;
  post_content: string | null;
  run_at: string | null;
  status: string;
  error_log: string | null;
  campaign_id?: string | null;
  scheduled_at?: string | null;
  platform?: string | null;
}

interface MonitoringDashboardProps {
  campaigns: any[];
  jobs: Job[];
  crawlerLogs: any[];
  activeLogTab: 'campaigns' | 'jobs' | 'crawler';
  setActiveLogTab: (tab: 'campaigns' | 'jobs' | 'crawler') => void;
  handleCampaignAction: (campaignId: string, action: 'pause' | 'resume' | 'cancel' | 'delete', accountId?: number) => void;
  handleJobAction: (id: number | number[], action: 'pause' | 'resume' | 'run_now' | 'delete') => void;
  handleClearCrawlerLogs: () => void;
  loading: boolean;
  selectedAccountIdFilter: string;
  setSelectedAccountIdFilter: (val: string) => void;
}

export default function MonitoringDashboard({
  campaigns,
  jobs,
  crawlerLogs,
  activeLogTab,
  setActiveLogTab,
  handleCampaignAction,
  handleJobAction,
  handleClearCrawlerLogs,
  loading,
  selectedAccountIdFilter,
  setSelectedAccountIdFilter
}: MonitoringDashboardProps) {
  const seedingJobs = jobs.filter(
    j => j.campaign_id !== null || j.type === 'comment' || j.type === 'threads_comment' || j.type === 'threads_post' || j.type === 'zalo_message' || j.type === 'telegram_message' || j.type.endsWith('_comment') || j.type.endsWith('_post')
  );

  const uniqueSeedingAccounts = Array.from(new Set(seedingJobs.map(j => j.username).filter((u): u is string => !!u)));

  const filteredSeedingJobs = selectedAccountIdFilter === 'all'
    ? seedingJobs
    : seedingJobs.filter(j => j.username === selectedAccountIdFilter);

  const failedJobsCount = seedingJobs.filter(j => j.status === 'failed').length;

  return (
    <div className="card system-monitoring-card" style={{ marginTop: '2rem', padding: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button 
            type="button"
            onClick={() => setActiveLogTab('campaigns')}
            style={{ 
              background: 'none', 
              border: 'none', 
              borderBottom: activeLogTab === 'campaigns' ? '2px solid var(--color-primary-hover)' : '2px solid transparent',
              color: activeLogTab === 'campaigns' ? 'var(--color-primary-hover)' : 'var(--text-secondary)',
              fontWeight: 600,
              cursor: 'pointer',
              paddingBottom: '0.5rem',
              fontSize: '0.9rem'
            }}
          >
            📊 Chiến dịch Seeding ({campaigns.length})
          </button>
          <button 
            type="button"
            onClick={() => setActiveLogTab('jobs')}
            style={{ 
              background: 'none', 
              border: 'none', 
              borderBottom: activeLogTab === 'jobs' ? '2px solid var(--color-primary-hover)' : '2px solid transparent',
              color: activeLogTab === 'jobs' ? 'var(--color-primary-hover)' : 'var(--text-secondary)',
              fontWeight: 600,
              cursor: 'pointer',
              paddingBottom: '0.5rem',
              fontSize: '0.9rem'
            }}
          >
            ⚡ Hàng đợi Tác vụ Jobs ({seedingJobs.length})
          </button>
          <button 
            type="button"
            onClick={() => setActiveLogTab('crawler')}
            style={{ 
              background: 'none', 
              border: 'none', 
              borderBottom: activeLogTab === 'crawler' ? '2px solid var(--color-primary-hover)' : '2px solid transparent',
              color: activeLogTab === 'crawler' ? 'var(--color-primary-hover)' : 'var(--text-secondary)',
              fontWeight: 600,
              cursor: 'pointer',
              paddingBottom: '0.5rem',
              fontSize: '0.9rem'
            }}
          >
            📜 Nhật ký Scraper cào ({crawlerLogs.length})
          </button>
        </div>

        {activeLogTab === 'crawler' && crawlerLogs.length > 0 && (
          <button 
            className="btn btn-danger" 
            onClick={handleClearCrawlerLogs}
            style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
            disabled={loading}
          >
            Xóa nhật ký
          </button>
        )}

        {activeLogTab === 'jobs' && failedJobsCount > 0 && (
          <button 
            className="btn btn-secondary" 
            onClick={() => {
              const failedIds = seedingJobs.filter(j => j.status === 'failed').map(j => j.id);
              handleJobAction(failedIds, 'run_now');
            }}
            style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', border: '1px solid var(--color-warning)', color: 'var(--color-warning)' }}
            disabled={loading}
          >
            ⚡ Retry ({failedJobsCount}) tác vụ thất bại
          </button>
        )}
      </div>

      {/* TAB 1: CAMPAIGNS */}
      {activeLogTab === 'campaigns' && (
        campaigns.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            Chưa có chiến dịch seeding nào được khởi tạo.
          </div>
        ) : (
          <div className="campaigns-grid-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem', maxHeight: '420px', overflowY: 'auto' }}>
            {campaigns.map((camp: any) => {
              const total = camp.total_jobs || 0;
              const completed = camp.completed_jobs || 0;
              const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
              return (
                <div key={camp.campaign_id} style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '8px', backgroundColor: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <div>
                      <strong style={{ fontSize: '0.88rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        🚀 {camp.name || `Chiến dịch Seeding ${camp.platform ? camp.platform.toUpperCase() : 'FACEBOOK'}`}
                      </strong>
                      <span className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', display: 'block', marginTop: '0.1rem' }}>
                        Mã: #{camp.campaign_id}
                      </span>
                    </div>
                    <span className={"badge " + ((camp.status || '').toLowerCase() === 'completed' ? 'badge-live' : (camp.status || '').toLowerCase() === 'paused' ? 'badge-checkpoint' : 'badge-platform')} style={{ fontSize: '0.65rem' }}>
                      {(camp.status || 'running').toUpperCase()}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Kênh: <span style={{ textTransform: 'uppercase', color: 'var(--text-primary)', fontWeight: 600 }}>{camp.platform || 'All'}</span> | Tiến độ: {completed}/{total} ({percent}%)
                  </div>
                  <div style={{ width: '100%', height: '6px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ width: `${percent}%`, height: '100%', backgroundColor: 'var(--color-primary-hover)', transition: 'width 0.3s ease' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.35rem', marginTop: '0.25rem' }}>
                    {camp.status === 'running' && (
                      <button type="button" onClick={() => handleCampaignAction(camp.campaign_id, 'pause')} className="btn btn-secondary" style={{ fontSize: '0.68rem', padding: '0.15rem 0.4rem' }}>⏸ Tạm dừng</button>
                    )}
                    {camp.status === 'paused' && (
                      <button type="button" onClick={() => handleCampaignAction(camp.campaign_id, 'resume')} className="btn btn-secondary" style={{ fontSize: '0.68rem', padding: '0.15rem 0.4rem' }}>▶ Tiếp tục</button>
                    )}
                    <button type="button" onClick={() => handleCampaignAction(camp.campaign_id, 'delete')} className="btn btn-danger" style={{ fontSize: '0.68rem', padding: '0.15rem 0.4rem' }}>🗑 Xóa</button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* TAB 2: JOBS */}
      {activeLogTab === 'jobs' && (
        seedingJobs.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            Không có tác vụ Seeding nào trong hàng đợi.
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <select
                className="form-input"
                value={selectedAccountIdFilter}
                onChange={(e) => setSelectedAccountIdFilter(e.target.value)}
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', width: 'auto', margin: 0 }}
              >
                <option value="all">-- Tất cả Tài khoản ({seedingJobs.length}) --</option>
                {uniqueSeedingAccounts.map(acc => (
                  <option key={acc} value={acc}>{acc}</option>
                ))}
              </select>
            </div>

            <div className="table-container" style={{ maxHeight: '350px', overflowY: 'auto' }}>
              <table className="table mini-table">
                <thead>
                  <tr>
                    <th>Tài khoản</th>
                    <th>Mục tiêu</th>
                    <th>Loại</th>
                    <th>Lên lịch</th>
                    <th>Trạng thái</th>
                    <th className="text-right">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSeedingJobs.map(job => (
                    <tr key={job.id}>
                      <td><strong style={{ fontSize: '0.75rem' }}>{job.username || 'Unassigned'}</strong></td>
                      <td className="font-mono" style={{ fontSize: '0.7rem', wordBreak: 'break-all' }}>{job.target_url || '-'}</td>
                      <td><span className="badge badge-platform" style={{ fontSize: '0.6rem' }}>{job.type}</span></td>
                      <td style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                        {job.run_at ? new Date(job.run_at).toLocaleTimeString('vi-VN') : 'Khởi chạy ngay'}
                      </td>
                      <td>
                        <span className={"badge " + (job.status === 'completed' ? 'badge-live' : job.status === 'failed' ? 'badge-die' : 'badge-checkpoint')} style={{ fontSize: '0.6rem' }}>
                          {(job.status || 'pending').toUpperCase()}
                        </span>
                      </td>
                      <td className="text-right">
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.2rem' }}>
                          {job.status === 'pending' && (
                            <button type="button" onClick={() => handleJobAction(job.id, 'run_now')} className="icon-action-btn" title="Chạy ngay" disabled={loading} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>⚡</button>
                          )}
                          <button type="button" onClick={() => handleJobAction(job.id, 'delete')} className="icon-action-btn btn-danger" title="Xóa" disabled={loading} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>🗑</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* TAB 3: CRAWLER LOGS */}
      {activeLogTab === 'crawler' && (
        crawlerLogs.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            Chưa có nhật ký cào bài viết nào.
          </div>
        ) : (
          <div className="table-container" style={{ maxHeight: '350px', overflowY: 'auto' }}>
            <table className="table mini-table">
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Mục tiêu</th>
                  <th>Bài viết cào được</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {crawlerLogs.map(log => (
                  <tr key={log.id}>
                    <td style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{new Date(log.created_at).toLocaleString('vi-VN')}</td>
                    <td style={{ fontSize: '0.75rem', fontWeight: 600 }}>{log.target_value}</td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--color-primary-hover)' }}>{log.posts_found || 0} bài</td>
                    <td>
                      <span className={"badge " + (log.status === 'success' ? 'badge-live' : 'badge-die')} style={{ fontSize: '0.6rem' }}>
                        {(log.status || 'unknown').toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
