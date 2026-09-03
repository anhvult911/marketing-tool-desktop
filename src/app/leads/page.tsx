'use client';

import { useState, useEffect } from 'react';
import ScrapeDrawer from '@/components/spam/ScrapeDrawer';
import ImportLeadModal from '@/components/leads/ImportLeadModal';
import LeadDetailDrawer from '@/components/leads/LeadDetailDrawer';

interface Lead {
  id: number;
  value: string;
  platform: string;
  display_name?: string | null;
  avatar_url?: string | null;
  source?: string | null;
  status: string;
  extra_data?: any;
  created_at?: string;
}

interface Account {
  id: number;
  platform: string;
  username: string;
  status: string;
}

interface LeadCollection {
  name: string;
  total: number;
  pending: number;
  sent: number;
  failed: number;
  platforms: string[];
  lastUpdated?: string;
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

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [leadsStats, setLeadsStats] = useState({
    total: 0,
    pending: 0,
    sent: 0,
    failed: 0,
    zalo: 0,
    telegram: 0,
    social: 0
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlatformFilter, setSelectedPlatformFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Modals & Drawers
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isScrapeDrawerOpen, setIsScrapeDrawerOpen] = useState(false);
  const [selectedCollectionName, setSelectedCollectionName] = useState<string | null>(null);

  const fetchLeads = async () => {
    const data = await safeFetchJson('/api/spam/leads');
    if (data.success) {
      setLeads(data.data || []);
      if (data.stats) setLeadsStats(data.stats);
    }
  };

  const fetchData = async () => {
    try {
      await Promise.allSettled([
        fetchLeads(),
        (async () => {
          const dataAccs = await safeFetchJson('/api/accounts');
          if (dataAccs.success && Array.isArray(dataAccs.data)) {
            setAccounts(dataAccs.data.filter((a: any) => {
              const stat = (a.status || '').toLowerCase().trim();
              return stat === 'live' || stat === 'ready' || stat === 'active';
            }));
          }
        })(),
        (async () => {
          const dataCamps = await safeFetchJson('/api/spam/campaign');
          if (dataCamps.success && Array.isArray(dataCamps.data)) {
            setCampaigns(dataCamps.data);
          }
        })()
      ]);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  // Group leads into Collections / Tập Leads
  const collectionsMap = new Map<string, LeadCollection>();
  leads.forEach(l => {
    const colName = l.source && l.source.trim() ? l.source.trim() : 'Danh_Sach_Thủ_Công';
    if (!collectionsMap.has(colName)) {
      collectionsMap.set(colName, {
        name: colName,
        total: 0,
        pending: 0,
        sent: 0,
        failed: 0,
        platforms: [],
        lastUpdated: l.created_at
      });
    }
    const col = collectionsMap.get(colName)!;
    col.total += 1;
    if (l.status === 'pending') col.pending += 1;
    else if (l.status === 'sent') col.sent += 1;
    else if (l.status === 'failed') col.failed += 1;
    if (l.platform && !col.platforms.includes(l.platform)) {
      col.platforms.push(l.platform);
    }
  });

  const collectionsList = Array.from(collectionsMap.values());

  const filteredCollections = collectionsList.filter(col => {
    const matchesSearch = col.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPlatform = selectedPlatformFilter === 'all' || col.platforms.includes(selectedPlatformFilter);
    return matchesSearch && matchesPlatform;
  });

  const handleDeleteLead = async (id: number) => {
    try {
      const data = await safeFetchJson('/api/spam/leads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (data.success) {
        fetchLeads();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteCollection = async (collectionName: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa toàn bộ Tập Leads "${collectionName}"?`)) return;
    setLoading(true);
    try {
      const data = await safeFetchJson('/api/spam/leads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: collectionName })
      });
      if (data.success) {
        setMessage({ text: data.message || `Đã xóa thành công Tập Leads "${collectionName}".`, type: 'success' });
        if (selectedCollectionName === collectionName) {
          setSelectedCollectionName(null);
        }
        await fetchLeads();
      } else {
        setMessage({ text: data.error || 'Lỗi khi xóa Tập Leads.', type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleResetCollection = async (collectionName: string) => {
    const targetIds = leads.filter(l => (l.source || 'Danh_Sach_Thủ_Công') === collectionName).map(l => l.id);
    if (targetIds.length === 0) return;
    setLoading(true);
    try {
      const data = await safeFetchJson('/api/spam/leads', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: false, ids: targetIds })
      });
      if (data.success) {
        setMessage({ text: `Đã đặt lại trạng thái Tập Leads "${collectionName}" về "SẴN SÀNG".`, type: 'success' });
        fetchLeads();
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleExportCollectionCSV = (collectionName: string) => {
    const colLeads = leads.filter(l => (l.source || 'Danh_Sach_Thủ_Công') === collectionName);
    if (colLeads.length === 0) return;
    
    let csvContent = 'data:text/csv;charset=utf-8,ID,Platform,Value,Source,Status\n';
    colLeads.forEach(l => {
      csvContent += `${l.id},"${l.platform}","${l.value}","${l.source || ''}","${l.status}"\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${collectionName.replace(/[^a-zA-Z0-9_-]/g, '_')}_export.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="leads-page-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            🎯 Kho Leads & Bộ Sưu Tập Mục Tiêu (Lead CRM)
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0 0' }}>
            Thu thập, phân loại tập khách hàng theo nguồn và quản lý danh sách mục tiêu
          </p>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setIsImportModalOpen(true)}
            className="btn btn-primary"
            style={{ fontSize: '0.88rem', padding: '0.55rem 1.5rem', fontWeight: 700 }}
          >
            ➕ Nạp & Thu Thập Tập Leads Mới
          </button>
        </div>
      </div>

      {/* Alert Notification */}
      {message && (
        <div 
          className="card alert-card" 
          style={{ 
            padding: '1rem', 
            backgroundColor: message.type === 'success' ? 'rgba(63, 185, 80, 0.15)' : 'rgba(248, 81, 73, 0.15)',
            borderColor: message.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)',
            color: message.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)',
            fontWeight: 600,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <span>{message.text}</span>
          <button type="button" onClick={() => setMessage(null)} style={{ border: 'none', background: 'none', color: 'currentColor', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* Overview Analytics Stats Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-value" style={{ color: 'var(--color-primary-hover)' }}>{leadsStats.total}</span>
          <span className="stat-label">Tổng Leads</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{collectionsList.length}</span>
          <span className="stat-label">Tập Leads / Collections</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{leads.filter(l => l.platform === 'facebook').length}</span>
          <span className="stat-label">Facebook</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{leads.filter(l => l.platform === 'telegram').length}</span>
          <span className="stat-label">Telegram</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{leads.filter(l => l.platform === 'zalo').length}</span>
          <span className="stat-label">Zalo</span>
        </div>
        <div className="stat-card" style={{ borderLeft: '3px solid var(--color-success)' }}>
          <span className="stat-value" style={{ color: 'var(--color-success)' }}>{leads.filter(l => l.status === 'pending').length}</span>
          <span className="stat-label">Sẵn sàng</span>
        </div>
      </div>

      {/* Toolbar & Filter Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            className="form-input"
            placeholder="🔍 Tìm kiếm Tập Leads..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '250px', fontSize: '0.8rem', padding: '0.45rem 0.75rem' }}
          />

          <select
            className="select"
            value={selectedPlatformFilter}
            onChange={(e) => setSelectedPlatformFilter(e.target.value)}
            style={{ width: 'auto', fontSize: '0.8rem', padding: '0.45rem 0.75rem' }}
          >
            <option value="all">-- Tất cả Kênh --</option>
            <option value="facebook">Facebook</option>
            <option value="telegram">Telegram</option>
            <option value="zalo">Zalo</option>
            <option value="x">X / Twitter</option>
          </select>
        </div>

        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Hiển thị <strong>{filteredCollections.length}</strong> / <strong>{collectionsList.length}</strong> Tập Leads
        </span>
      </div>

      {/* Main Collections Cards Grid */}
      {filteredCollections.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <p style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Chưa có Tập Leads nào trong kho.</p>
          <p style={{ fontSize: '0.8rem', marginBottom: '1.25rem' }}>Hãy nạp tập Leads mới từ file CSV/TXT hoặc cào nhóm để bắt đầu quản lý.</p>
          <button 
            onClick={() => setIsImportModalOpen(true)}
            className="btn btn-primary"
            style={{ fontSize: '0.85rem', padding: '0.5rem 1.25rem' }}
          >
            ➕ Nạp Tập Leads Mới Ngay
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.25rem' }}>
          {filteredCollections.map(col => (
            <div 
              key={col.name} 
              className="card"
              style={{
                padding: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
                transition: 'all 0.2s ease'
              }}
            >
              <div>
                {/* Header of Card */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0, wordBreak: 'break-word' }}>
                    📁 {col.name}
                  </h3>
                  <span className="badge badge-live" style={{ fontSize: '0.75rem', fontWeight: 700 }}>
                    {col.total} Leads
                  </span>
                </div>

                {/* Platforms Badges */}
                <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                  {col.platforms.map(p => (
                    <span key={p} className="badge badge-platform" style={{ fontSize: '0.62rem', textTransform: 'uppercase' }}>
                      {p}
                    </span>
                  ))}
                </div>

                {/* Progress Health Status */}
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                    <span>Sẵn sàng: <strong style={{ color: 'var(--color-success)' }}>{col.pending}</strong></span>
                    <span>Đã gửi: <strong style={{ color: 'var(--color-primary-hover)' }}>{col.sent}</strong></span>
                    <span>Lỗi: <strong style={{ color: 'var(--color-danger)' }}>{col.failed}</strong></span>
                  </div>

                  {/* Progress Bar */}
                  <div style={{ width: '100%', height: '6px', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: '3px', overflow: 'hidden', display: 'flex' }}>
                    <div style={{ width: `${(col.pending / col.total) * 100}%`, backgroundColor: 'var(--color-success)' }} />
                    <div style={{ width: `${(col.sent / col.total) * 100}%`, backgroundColor: 'var(--color-primary-hover)' }} />
                    <div style={{ width: `${(col.failed / col.total) * 100}%`, backgroundColor: 'var(--color-danger)' }} />
                  </div>
                </div>
              </div>

              {/* Card Action Controls */}
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem', marginTop: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => setSelectedCollectionName(col.name)}
                  className="btn btn-primary"
                  style={{ fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}
                >
                  👁️ Xem Chi tiết ({col.total})
                </button>

                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  <button
                    type="button"
                    onClick={() => handleExportCollectionCSV(col.name)}
                    className="btn btn-secondary"
                    style={{ fontSize: '0.7rem', padding: '0.25rem 0.45rem' }}
                    title="Xuất file CSV riêng của tập này"
                  >
                    📥 CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => handleResetCollection(col.name)}
                    className="btn btn-secondary"
                    style={{ fontSize: '0.7rem', padding: '0.25rem 0.45rem' }}
                    title="Đặt tất cả Leads về trạng thái Sẵn sàng"
                  >
                    🔄
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteCollection(col.name)}
                    className="btn btn-danger"
                    style={{ fontSize: '0.7rem', padding: '0.25rem 0.45rem' }}
                    title="Xóa toàn bộ tập Leads này"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Import Lead Modal */}
      <ImportLeadModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onSuccess={fetchLeads}
        onOpenScrapeDrawer={() => setIsScrapeDrawerOpen(true)}
      />

      {/* Lead Collection Detail Drawer */}
      {selectedCollectionName && (
        <LeadDetailDrawer
          isOpen={!!selectedCollectionName}
          onClose={() => setSelectedCollectionName(null)}
          collectionName={selectedCollectionName}
          leads={leads}
          onRefresh={fetchLeads}
          onResetLeads={async (all, ids) => {
            await safeFetchJson('/api/spam/leads', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ all, ids })
            });
            fetchLeads();
          }}
          onDeleteLead={async (id) => {
            await handleDeleteLead(id);
          }}
          onClearAllLeads={async () => {
            await handleDeleteCollection(selectedCollectionName);
            setSelectedCollectionName(null);
          }}
          loading={loading}
        />
      )}

      {/* Scrape Drawer */}
      <ScrapeDrawer
        isOpen={isScrapeDrawerOpen}
        onClose={() => setIsScrapeDrawerOpen(false)}
        accounts={accounts}
        campaigns={campaigns}
        onSuccess={fetchLeads}
      />
    </div>
  );
}
