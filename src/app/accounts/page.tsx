'use client';

import { useState, useEffect, useRef } from 'react';

interface Proxy {
  id: number;
  host: string;
  port: number;
  username?: string;
  password?: string;
  status: string;
  last_checked?: string;
  account_count?: number;
  accounts?: string[];
}

interface Account {
  id: number;
  platform: string;
  username: string;
  password?: string;
  email?: string;
  proxy_id?: number;
  proxy_display?: string;
  status: string;
  last_checked?: string;
  auth_token?: string;
}

export default function AccountsPage() {
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  
  // Forms state
  const [rawProxies, setRawProxies] = useState('');
  const [rawAccounts, setRawAccounts] = useState('');
  const [importPlatform, setImportPlatform] = useState('x');
  const [activeTab, setActiveTab] = useState('all');
  const [selectedProxyIdForAccUpdate, setSelectedProxyIdForAccUpdate] = useState<Record<number, string>>({});
  
  // Selection states
  const [selectedAccs, setSelectedAccs] = useState<number[]>([]);
  const [bulkProxyId, setBulkProxyId] = useState('');

  // Status state
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Profile Sync 1-Click states
  const [syncLoading, setSyncLoading] = useState(false);
  const profileFileInputRef = useRef<HTMLInputElement | null>(null);

  // Cookie Import Modal States
  const [cookieModalAccountId, setCookieModalAccountId] = useState<number | null>(null);
  const [cookieModalValue, setCookieModalValue] = useState('');
  const [cookieModalLoading, setCookieModalLoading] = useState(false);
  const [cookieModalError, setCookieModalError] = useState<string | null>(null);
  const [cookieModalSuccess, setCookieModalSuccess] = useState<string | null>(null);

  // Fetch data
  const fetchData = async () => {
    try {
      const resProxies = await fetch('/api/proxies');
      const dataProxies = await resProxies.json();
      if (dataProxies.success) setProxies(dataProxies.data);

      const resAccounts = await fetch('/api/accounts');
      const dataAccounts = await resAccounts.json();
      if (dataAccounts.success) {
        setAccounts(dataAccounts.data);
        
        // Initial selected proxy map
        const initialMap: Record<number, string> = {};
        dataAccounts.data.forEach((acc: Account) => {
          initialMap[acc.id] = acc.proxy_id ? String(acc.proxy_id) : '';
        });
        setSelectedProxyIdForAccUpdate(initialMap);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  };

  useEffect(() => {
    fetchData();
    // Poll account status updates every 12 seconds only when visible
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchData();
      }
    }, 12000);
    return () => clearInterval(interval);
  }, []);

  // Auto-dismiss success alert messages after 5 seconds
  useEffect(() => {
    if (message && message.type === 'success') {
      const timer = setTimeout(() => {
        setMessage(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const handleImportProxies = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawProxies.trim()) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/proxies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: rawProxies }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ text: data.message, type: 'success' });
        setRawProxies('');
        fetchData();
      } else {
        setMessage({ text: data.error, type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleImportAccounts = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawAccounts.trim()) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: rawAccounts, platform: importPlatform }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ text: data.message, type: 'success' });
        setRawAccounts('');
        fetchData();
      } else {
        setMessage({ text: data.error, type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProxy = async (id: number) => {
    if (!confirm('Bạn có chắc chắn muốn xóa proxy này?')) return;
    try {
      const res = await fetch('/api/proxies', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (data.success) {
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAutoDistributeProxy = async () => {
    if (!confirm('Bạn có chắc chắn muốn tự động chia đều các proxy hoạt động cho toàn bộ tài khoản?')) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/accounts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auto-distribute' }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ text: data.message, type: 'success' });
        fetchData();
      } else {
        setMessage({ text: data.error, type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleCheckProxyLive = async (id?: number) => {
    setLoading(true);
    setMessage({ text: id ? 'Đang kiểm tra trạng thái proxy...' : 'Đang kiểm tra toàn bộ proxy...', type: 'success' });
    try {
      const res = await fetch('/api/proxies/check-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ text: data.message, type: 'success' });
        fetchData();
      } else {
        setMessage({ text: data.error, type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = async (id: number) => {
    if (!confirm('Bạn có chắc chắn muốn xóa tài khoản này?')) return;
    try {
      const res = await fetch('/api/accounts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (data.success) {
        setSelectedAccs(prev => prev.filter(x => x !== id));
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateAccountProxy = async (accountId: number, proxyId: string) => {
    try {
      const res = await fetch('/api/accounts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, proxyId: proxyId ? parseInt(proxyId, 10) : null }),
      });
      const data = await res.json();
      if (data.success) {
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateAuthToken = async (accountId: number, token: string) => {
    try {
      const res = await fetch('/api/accounts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, authToken: token }),
      });
      const data = await res.json();
      if (data.success) {
        if (token) {
          setMessage({ text: 'Đã cập nhật auth_token! Đang tự động kiểm tra lại trạng thái...', type: 'success' });
          await handleCheckLive(accountId);
        } else {
          fetchData();
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenBrowser = async (accountId: number) => {
    setLoading(true);
    setMessage({ text: 'Đang mở trình duyệt... Hãy hoàn tất đăng nhập/xác minh và đóng trình duyệt để tiếp tục.', type: 'success' });
    try {
      const res = await fetch('/api/accounts/open-browser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ text: 'Đã đóng trình duyệt! Đang tự động kiểm tra lại trạng thái...', type: 'success' });
        await handleCheckLive(accountId);
      } else {
        setMessage({ text: `Lỗi: ${data.error}`, type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleUniversalVpsLoginStart = async (accountId: number) => {
    return handleOpenBrowser(accountId);
  };

  const handleOpenCookieModal = (acc: Account) => {
    setCookieModalAccountId(acc.id);
    setCookieModalValue(acc.auth_token || '');
    setCookieModalLoading(false);
    setCookieModalError(null);
    setCookieModalSuccess(null);
  };

  const handleCloseCookieModal = () => {
    setCookieModalAccountId(null);
    setCookieModalValue('');
    setCookieModalLoading(false);
    setCookieModalError(null);
    setCookieModalSuccess(null);
  };

  const handleSubmitCookieImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cookieModalAccountId || !cookieModalValue.trim()) return;
    setCookieModalLoading(true);
    setCookieModalError(null);
    setCookieModalSuccess(null);

    try {
      const res = await fetch('/api/accounts/import-cookies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          accountId: cookieModalAccountId, 
          cookies: cookieModalValue.trim() 
        }),
      });
      const data = await res.json();
      if (data.success) {
        setCookieModalSuccess(data.message || 'Đã nạp Cookie thành công!');
        fetchData();
        setTimeout(() => {
          handleCloseCookieModal();
        }, 2000);
      } else {
        setCookieModalError(data.error || 'Nạp Cookie thất bại.');
      }
    } catch (err: any) {
      setCookieModalError(err.message || 'Lỗi hệ thống.');
    } finally {
      setCookieModalLoading(false);
    }
  };

  const handleCheckLive = async (accountId?: number) => {
    try {
      const res = await fetch('/api/accounts/check-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ text: data.message, type: 'success' });
      } else {
        setMessage({ text: data.error, type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    }
  };

  // Selection Handlers
  const handleAccSelectToggle = (id: number) => {
    setSelectedAccs(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleSelectAllAccs = () => {
    const allFilteredIds = filteredAccounts.map(acc => acc.id);
    const hasAllSelected = allFilteredIds.every(id => selectedAccs.includes(id));
    if (hasAllSelected) {
      setSelectedAccs(prev => prev.filter(id => !allFilteredIds.includes(id)));
    } else {
      setSelectedAccs(prev => Array.from(new Set([...prev, ...allFilteredIds])));
    }
  };

  // Bulk Actions
  const handleBulkCheckLive = async () => {
    if (selectedAccs.length === 0) return;
    setLoading(true);
    setMessage({ text: `Đang khởi tạo yêu cầu kiểm tra cho ${selectedAccs.length} tài khoản đã chọn...`, type: 'success' });
    try {
      const res = await fetch('/api/accounts/check-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountIds: selectedAccs }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ text: data.message, type: 'success' });
        setSelectedAccs([]);
      } else {
        setMessage({ text: data.error, type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleBulkDeleteAccounts = async () => {
    if (selectedAccs.length === 0) return;
    if (!confirm(`Bạn có chắc chắn muốn xóa ${selectedAccs.length} tài khoản đã chọn?`)) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/accounts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedAccs }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ text: `Đã xóa thành công ${selectedAccs.length} tài khoản.`, type: 'success' });
        setSelectedAccs([]);
        fetchData();
      } else {
        setMessage({ text: data.error, type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleBulkAssignProxy = async () => {
    if (selectedAccs.length === 0) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/accounts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          accountIds: selectedAccs, 
          proxyId: bulkProxyId ? parseInt(bulkProxyId, 10) : null 
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ text: `Đã gán proxy hàng loạt cho ${selectedAccs.length} tài khoản thành công.`, type: 'success' });
        setSelectedAccs([]);
        setBulkProxyId('');
        fetchData();
      } else {
        setMessage({ text: data.error, type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleExportProfiles = async () => {
    setSyncLoading(true);
    setMessage({ text: 'Đang nén và chuẩn bị tải về toàn bộ phiên đăng nhập profiles...', type: 'success' });
    try {
      const res = await fetch('/api/accounts/sync-profiles');
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Lỗi xuất profiles');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `profiles_backup_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setMessage({ text: 'Đã xuất file profiles_backup.zip thành công! Bạn có thể tải file này lên VPS.', type: 'success' });
    } catch (err: any) {
      setMessage({ text: err.message || 'Lỗi xuất Profiles', type: 'error' });
    } finally {
      setSyncLoading(false);
    }
  };

  const handleImportProfilesFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSyncLoading(true);
    setMessage({ text: 'Đang tải lên và giải nén Profiles vào hệ thống...', type: 'success' });
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/accounts/sync-profiles', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ text: data.message || 'Đã đồng bộ Profiles thành công!', type: 'success' });
        fetchData();
      } else {
        setMessage({ text: data.error || 'Lỗi nhập profiles', type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message || 'Lỗi nhập profiles', type: 'error' });
    } finally {
      setSyncLoading(false);
      if (profileFileInputRef.current) profileFileInputRef.current.value = '';
    }
  };

  const filteredAccounts = accounts.filter(acc => {
    if (activeTab === 'all') return true;
    if (activeTab === 'other') return !['x', 'telegram', 'zalo', 'whatsapp', 'threads', 'newf319', 'facebook', 'instagram', 'tiktok', 'youtube'].includes(acc.platform);
    return acc.platform === activeTab;
  });

  return (
    <div>
      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Tài khoản & Proxy</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Quản lý tài khoản mạng xã hội và diễn đàn đa kênh (X, newf319.com, Zalo, WhatsApp, Telegram, Threads, Facebook, YouTube, TikTok, Instagram) và danh sách máy chủ Proxy.
          </p>
        </div>

        {/* 1-Click Profile Sync Actions */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn"
            onClick={handleExportProfiles}
            disabled={syncLoading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              backgroundColor: '#1e293b',
              color: '#38bdf8',
              border: '1px solid #334155',
              fontSize: '0.875rem',
              fontWeight: 500,
              padding: '0.5rem 0.85rem',
              borderRadius: '6px',
              cursor: syncLoading ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease'
            }}
            title="Tải về file nén toàn bộ Cookies, LocalStorage và Session của các tài khoản để chuyển lên VPS"
          >
            <span>📥</span> {syncLoading ? 'Đang xử lý...' : 'Sao lưu Profiles (.zip)'}
          </button>

          <button
            type="button"
            className="btn"
            onClick={() => profileFileInputRef.current?.click()}
            disabled={syncLoading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              backgroundColor: '#0f766e',
              color: '#ffffff',
              border: 'none',
              fontSize: '0.875rem',
              fontWeight: 500,
              padding: '0.5rem 0.85rem',
              borderRadius: '6px',
              cursor: syncLoading ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease'
            }}
            title="Tải lên file zip backup profiles để khôi phục phiên đăng nhập vào hệ thống VPS"
          >
            <span>📤</span> {syncLoading ? 'Đang nạp...' : 'Đồng bộ Profiles (.zip)'}
          </button>

          <input
            type="file"
            ref={profileFileInputRef}
            accept=".zip"
            onChange={handleImportProfilesFile}
            style={{ display: 'none' }}
          />
        </div>
      </div>

      {/* Message Alert */}
      {message && (
        <div className={`alert alert-${message.type}`}>
          <span>{message.text}</span>
          <button 
            type="button" 
            onClick={() => setMessage(null)}
            style={{ 
              background: 'none', 
              border: 'none', 
              color: 'inherit', 
              cursor: 'pointer', 
              fontSize: '1.25rem', 
              fontWeight: 'bold',
              lineHeight: 1,
              padding: '0 0.5rem'
            }}
            title="Đóng thông báo"
          >
            &times;
          </button>
        </div>
      )}

      {/* TOP ROW: FORMS (GRID) */}
      <div className="responsive-grid-2-cols" style={{ marginBottom: '2rem' }}>
        {/* Nhập tài khoản Form */}
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-title">Nhập tài khoản Đa Kênh</div>
          <form onSubmit={handleImportAccounts}>
            <div className="form-group">
              <label className="form-label">Chọn nền tảng tài khoản</label>
              <select
                className="select"
                value={importPlatform}
                onChange={(e) => setImportPlatform(e.target.value)}
                style={{ width: '100%', marginBottom: '0.75rem', height: '2.2rem' }}
              >
                <option value="x">X (Twitter)</option>
                <option value="newf319">newf319.com</option>
                <option value="zalo">Zalo</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="telegram">Telegram</option>
                <option value="threads">Threads</option>
                <option value="facebook">Facebook</option>
                <option value="instagram">Instagram</option>
                <option value="tiktok">TikTok</option>
                <option value="youtube">YouTube</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">
                Định dạng: {importPlatform === 'x' ? 'username|password|email|proxy' : (importPlatform === 'zalo' || importPlatform === 'whatsapp') ? 'phone|password|email|proxy' : 'username|password|email|proxy'} (Mỗi tài khoản 1 dòng)
              </label>
              <textarea
                className="textarea"
                value={rawAccounts}
                onChange={(e) => setRawAccounts(e.target.value)}
                placeholder={
                  importPlatform === 'x'
                    ? "elonmusk|Password123|elon@spacex.com|192.168.1.100:8080\njeffbezos|Pass456|jeff@amazon.com|user:pass@1.2.3.4:8080"
                    : importPlatform === 'newf319'
                    ? "username|Password123|user_mail@gmail.com|192.168.1.100:8080"
                    : importPlatform === 'zalo'
                    ? "0912345678|MậtKhẩu123|zalo_mail@gmail.com|192.168.1.100:8080"
                    : importPlatform === 'whatsapp'
                    ? "84912345678|MậtKhẩu123|wa_mail@gmail.com|192.168.1.100:8080"
                    : importPlatform === 'telegram'
                    ? "telegram_user|MậtKhẩu123|tele_mail@gmail.com|192.168.1.100:8080"
                    : "username|password|email|proxy"
                }
                style={{ minHeight: '120px' }}
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading || !rawAccounts.trim()}>
              {loading ? 'Đang xử lý...' : '📥 Nhập tài khoản'}
            </button>
          </form>
        </div>

        {/* Nhập Proxy Form */}
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-title">Nhập Proxy</div>
          <form onSubmit={handleImportProxies}>
            <div className="form-group">
              <label className="form-label">
                Định dạng: host:port hoặc host:port:user:pass hoặc user:pass@host:port (Mỗi proxy 1 dòng)
              </label>
              <textarea
                className="textarea"
                value={rawProxies}
                onChange={(e) => setRawProxies(e.target.value)}
                placeholder="192.168.1.1:8080&#10;192.168.1.2:8080:username:password"
                style={{ minHeight: '120px' }}
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading || !rawProxies.trim()}>
              {loading ? 'Đang xử lý...' : '🌐 Nhập Proxy'}
            </button>
          </form>
        </div>
      </div>

      {/* BOTTOM ROW: TABLES (VERTICAL STACK - FULL WIDTH) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        {/* Accounts Table Card */}
        <div className="card" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
            <div className="card-title" style={{ margin: 0 }}>
              Danh sách tài khoản ({filteredAccounts.length}/{accounts.length})
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              {selectedAccs.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', backgroundColor: 'var(--border-color)', padding: '0.4rem 0.8rem', borderRadius: '6px', fontSize: '0.85rem', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600 }}>Đã chọn: {selectedAccs.length}</span>
                  <button 
                    type="button" 
                    className="btn btn-secondary" 
                    onClick={handleBulkCheckLive}
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', borderColor: 'var(--color-primary-hover)', color: 'var(--color-primary-hover)' }}
                    disabled={loading}
                  >
                    Check Live
                  </button>
                  
                  {/* Bulk Proxy Assign Dropdown */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <select
                      className="select"
                      value={bulkProxyId}
                      onChange={(e) => setBulkProxyId(e.target.value)}
                      style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem', height: '1.8rem', width: '130px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}
                    >
                      <option value="">Không dùng proxy</option>
                      {proxies.map(p => (
                        <option key={p.id} value={p.id}>
                          #{p.id} - {p.host}:{p.port}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleBulkAssignProxy}
                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                      disabled={loading}
                    >
                      Gán Proxy
                    </button>
                  </div>

                  <button 
                    type="button" 
                    className="btn btn-danger" 
                    onClick={handleBulkDeleteAccounts}
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', backgroundColor: 'var(--color-danger)', border: 'none', color: '#ffffff' }}
                    disabled={loading}
                  >
                    Xóa đã chọn
                  </button>
                </div>
              )}
              <button 
                type="button"
                className="btn btn-secondary" 
                onClick={handleAutoDistributeProxy}
                style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem', borderColor: 'var(--color-primary-hover)', color: 'var(--color-primary-hover)' }}
                disabled={loading}
              >
                🤖 Tự động chia đều Proxy
              </button>
              <button 
                type="button"
                className="btn btn-secondary" 
                onClick={() => handleCheckLive()}
                style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}
                disabled={loading}
              >
                🔄 Check Live Tất cả
              </button>
            </div>
          </div>

          {/* Platform Filter Tabs */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', overflowX: 'auto', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-color)', paddingLeft: '0.25rem', paddingRight: '0.25rem' }}>
            {[
              { id: 'all', label: 'Tất cả' },
              { id: 'x', label: 'X (Twitter)' },
              { id: 'newf319', label: 'newf319.com' },
              { id: 'zalo', label: 'Zalo' },
              { id: 'whatsapp', label: 'WhatsApp' },
              { id: 'telegram', label: 'Telegram' },
              { id: 'threads', label: 'Threads' },
              { id: 'facebook', label: 'Facebook' },
              { id: 'instagram', label: 'Instagram' },
              { id: 'tiktok', label: 'TikTok' },
              { id: 'youtube', label: 'YouTube' },
              { id: 'other', label: 'Khác' }
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id);
                  setSelectedAccs([]);
                }}
                className="btn"
                style={{
                  padding: '0.3rem 0.6rem',
                  fontSize: '0.8rem',
                  borderRadius: '20px',
                  whiteSpace: 'nowrap',
                  backgroundColor: activeTab === tab.id ? 'var(--color-primary-hover)' : 'var(--bg-secondary)',
                  color: activeTab === tab.id ? '#ffffff' : 'var(--text-secondary)',
                  border: activeTab === tab.id ? '1px solid var(--color-primary-hover)' : '1px solid var(--border-color)',
                  cursor: 'pointer'
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {accounts.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Chưa có tài khoản nào được nhập.
            </div>
          ) : filteredAccounts.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Không tìm thấy tài khoản nào cho bộ lọc hiện tại.
            </div>
          ) : (
            <>
              {/* Mobile View: List of Cards */}
              <div className="show-on-mobile" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {filteredAccounts.map(acc => {
                  let badgeClass = 'badge-unknown';
                  if (acc.status === 'live') badgeClass = 'badge-live';
                  else if (acc.status === 'die') badgeClass = 'badge-die';
                  else if (acc.status === 'checkpoint') badgeClass = 'badge-checkpoint';

                  return (
                    <div 
                      key={acc.id} 
                      style={{ 
                        border: '1px solid var(--border-color)', 
                        borderRadius: '8px', 
                        padding: '1rem', 
                        backgroundColor: 'var(--bg-primary)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.75rem'
                      }}
                    >
                      {/* Header: Checkbox + Username + Status */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                          <input 
                            type="checkbox" 
                            checked={selectedAccs.includes(acc.id)} 
                            onChange={() => handleAccSelectToggle(acc.id)}
                            style={{ cursor: 'pointer' }}
                          />
                          <strong style={{ fontSize: '1rem' }}>@{acc.username}</strong>
                          <span className="badge badge-unknown" style={{ fontSize: '0.65rem', padding: '0.1rem 0.3rem', textTransform: 'uppercase', height: 'fit-content' }}>
                            {acc.platform}
                          </span>
                        </label>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem' }}>
                          <span className={`badge ${badgeClass}`} style={{ fontSize: '0.7rem' }}>{acc.status}</span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {acc.last_checked ? new Date(acc.last_checked).toLocaleTimeString() : 'Chưa check'}
                          </span>
                        </div>
                      </div>

                      {/* Email & Token */}
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        <div>Email: {acc.email || '-'}</div>
                        
                        <div style={{ display: 'flex', alignItems: 'center', marginTop: '0.5rem', gap: '0.25rem' }}>
                          <span style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Token:</span>
                          <input
                            type="password"
                            className="input"
                            placeholder="Dán auth_token vào đây..."
                            defaultValue={acc.auth_token || ''}
                            onBlur={(e) => handleUpdateAuthToken(acc.id, e.target.value)}
                            style={{ 
                              padding: '0.2rem 0.5rem', 
                              fontSize: '0.75rem', 
                              height: '1.6rem', 
                              flex: 1, 
                              backgroundColor: 'var(--bg-secondary)', 
                              border: '1px solid var(--border-color)', 
                              borderRadius: '4px' 
                            }}
                          />
                        </div>
                      </div>

                      {/* Proxy Dropdown */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>PROXY LIÊN KẾT:</span>
                        <select
                          className="select"
                          value={selectedProxyIdForAccUpdate[acc.id] || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSelectedProxyIdForAccUpdate(prev => ({ ...prev, [acc.id]: val }));
                            handleUpdateAccountProxy(acc.id, val);
                          }}
                          style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem', width: '100%', backgroundColor: 'var(--bg-secondary)' }}
                        >
                          <option value="">Không dùng</option>
                          {proxies.map(p => (
                            <option key={p.id} value={p.id}>
                              #{p.id} - {p.host}:{p.port}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Actions Buttons */}
                      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                        <button
                          className="btn btn-secondary"
                          onClick={() => handleOpenBrowser(acc.id)}
                          title="Mở trình duyệt thật để đăng nhập, quét mã hoặc giải Captcha"
                          style={{ flex: 1, minWidth: '70px', padding: '0.35rem 0', fontSize: '0.75rem', borderColor: 'var(--color-primary)', color: 'var(--color-primary)', backgroundColor: 'transparent' }}
                          disabled={loading}
                        >
                          🌐 Mở Browser
                        </button>
                        <button
                          className="btn btn-secondary"
                          onClick={() => handleOpenCookieModal(acc)}
                          style={{ flex: 1, minWidth: '65px', padding: '0.35rem 0', fontSize: '0.75rem', backgroundColor: 'transparent' }}
                          title="Nhập Cookie / Session trực tiếp"
                          disabled={loading}
                        >
                          🍪 Cookie
                        </button>
                        <button
                          className="btn btn-secondary"
                          onClick={() => handleCheckLive(acc.id)}
                          style={{ flex: 1, minWidth: '50px', padding: '0.35rem 0', fontSize: '0.75rem', backgroundColor: 'transparent' }}
                          disabled={loading}
                        >
                          ⚡ Check
                        </button>
                        <button
                          className="btn btn-danger"
                          onClick={() => handleDeleteAccount(acc.id)}
                          style={{ flex: 1, minWidth: '50px', padding: '0.35rem 0', fontSize: '0.75rem', backgroundColor: 'transparent', border: '1px solid var(--color-danger)', color: 'var(--color-danger)' }}
                          disabled={loading}
                        >
                          🗑️ Xóa
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop View: Table */}
              <div className="hide-on-mobile table-container">
                <table className="table table-valign-top">
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }}>
                        <input 
                          type="checkbox" 
                          checked={filteredAccounts.length > 0 && filteredAccounts.every(acc => selectedAccs.includes(acc.id))} 
                          onChange={handleSelectAllAccs}
                          style={{ cursor: 'pointer', marginTop: '4px' }}
                        />
                      </th>
                      <th style={{ width: '30%', minWidth: '220px' }}>Tài khoản</th>
                      <th style={{ width: '15%', minWidth: '110px' }}>Trạng thái</th>
                      <th style={{ width: '20%', minWidth: '160px' }}>Proxy liên kết</th>
                      <th style={{ width: '35%', minWidth: '220px' }} className="text-right">Hành động</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAccounts.map((acc) => {
                      let badgeClass = 'badge-unknown';
                      if (acc.status === 'live') badgeClass = 'badge-live';
                      else if (acc.status === 'die') badgeClass = 'badge-die';
                      else if (acc.status === 'checkpoint') badgeClass = 'badge-checkpoint';

                      return (
                        <tr key={acc.id}>
                          <td>
                            <input 
                              type="checkbox" 
                              checked={selectedAccs.includes(acc.id)} 
                              onChange={() => handleAccSelectToggle(acc.id)}
                              style={{ cursor: 'pointer', marginTop: '4px' }}
                            />
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <strong>@{acc.username}</strong>
                              <span className="badge badge-unknown" style={{ fontSize: '0.65rem', padding: '0.1rem 0.3rem', textTransform: 'uppercase' }}>
                                {acc.platform}
                              </span>
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                              Email: {acc.email || '-'}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', marginTop: '0.4rem', gap: '0.25rem' }}>
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Token:</span>
                              <input
                                type="password"
                                className="input"
                                placeholder="Dán auth_token..."
                                defaultValue={acc.auth_token || ''}
                                onBlur={(e) => handleUpdateAuthToken(acc.id, e.target.value)}
                                style={{ 
                                  padding: '0.1rem 0.25rem', 
                                  fontSize: '0.7rem', 
                                  height: '1.3rem', 
                                  width: '120px', 
                                  backgroundColor: 'var(--bg-primary)', 
                                  border: '1px solid var(--border-color)', 
                                  borderRadius: '4px' 
                                }}
                              />
                            </div>
                          </td>
                          <td>
                            <span className={`badge ${badgeClass}`} style={{ marginTop: '2px' }}>{acc.status}</span>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                              {acc.last_checked ? new Date(acc.last_checked).toLocaleTimeString() : 'Chưa check'}
                            </div>
                          </td>
                          <td>
                            <select
                              className="select"
                              value={selectedProxyIdForAccUpdate[acc.id] || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setSelectedProxyIdForAccUpdate(prev => ({ ...prev, [acc.id]: val }));
                                handleUpdateAccountProxy(acc.id, val);
                              }}
                              style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', width: '100%', maxWidth: '140px', marginTop: '2px' }}
                            >
                              <option value="">Không dùng</option>
                              {proxies.map(p => (
                                <option key={p.id} value={p.id}>
                                  #{p.id} - {p.host}:{p.port}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="text-right">
                            <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end', alignItems: 'center', marginTop: '2px' }}>
                              <button
                                className="btn btn-secondary"
                                onClick={() => handleOpenBrowser(acc.id)}
                                title="Mở trình duyệt thật để đăng nhập, quét mã QR hoặc giải Captcha"
                                style={{ 
                                  padding: '0.25rem 0.4rem', 
                                  fontSize: '0.8rem', 
                                  borderColor: 'var(--color-primary)', 
                                  color: 'var(--color-primary)',
                                  backgroundColor: 'transparent'
                                }}
                                disabled={loading}
                              >
                                🌐 Mở Browser
                              </button>
                              <button
                                className="btn btn-secondary"
                                onClick={() => handleOpenCookieModal(acc)}
                                title="Nhập Cookie / Session trực tiếp (bỏ qua mật khẩu/2FA/Captcha)"
                                style={{ 
                                  padding: '0.25rem 0.4rem', 
                                  fontSize: '0.8rem', 
                                  backgroundColor: 'transparent'
                                }}
                                disabled={loading}
                              >
                                🍪 Cookie
                              </button>
                              <button
                                className="btn btn-secondary"
                                onClick={() => handleCheckLive(acc.id)}
                                title="Kiểm tra Live/Die"
                                style={{ 
                                  padding: '0.25rem 0.4rem', 
                                  fontSize: '0.8rem',
                                  backgroundColor: 'transparent'
                                }}
                                disabled={loading}
                              >
                                ⚡ Check
                              </button>
                              <button
                                className="btn btn-danger"
                                onClick={() => handleDeleteAccount(acc.id)}
                                style={{ 
                                  padding: '0.25rem 0.4rem', 
                                  fontSize: '0.8rem', 
                                  backgroundColor: 'transparent', 
                                  border: '1px solid var(--color-danger)', 
                                  color: 'var(--color-danger)' 
                                }}
                                disabled={loading}
                              >
                                🗑️ Xóa
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Proxies Table Card */}
        <div className="card" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div className="card-title" style={{ margin: 0 }}>Danh sách Proxy ({proxies.length})</div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleCheckProxyLive()}
              style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
              disabled={loading}
            >
              ⚡ Check Live Toàn bộ
            </button>
          </div>

          {proxies.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Chưa có proxy nào được nhập.
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Proxy</th>
                    <th>Tài khoản / Mật khẩu</th>
                    <th>Trạng thái</th>
                    <th>Tài khoản liên kết</th>
                    <th className="text-right">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {proxies.map((proxy) => {
                    let badgeClass = 'badge-unknown';
                    let statusLabel = 'Chưa Check';
                    if (proxy.status === 'working') {
                      badgeClass = 'badge-live';
                      statusLabel = 'Hoạt động';
                    } else if (proxy.status === 'dead') {
                      badgeClass = 'badge-die';
                      statusLabel = 'Lỗi';
                    }

                    return (
                      <tr key={proxy.id}>
                        <td>#{proxy.id}</td>
                        <td>
                          <strong>{proxy.host}:{proxy.port}</strong>
                        </td>
                        <td>
                          {proxy.username ? (
                            <span style={{ fontSize: '0.85rem' }}>
                              User: <code style={{ backgroundColor: 'var(--bg-primary)', padding: '2px 4px', borderRadius: '4px' }}>{proxy.username}</code>
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No Auth</span>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${badgeClass}`} style={{ fontSize: '0.7rem' }}>
                            {statusLabel}
                          </span>
                          {proxy.last_checked && (
                            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                              {new Date(proxy.last_checked).toLocaleTimeString('vi-VN')}
                            </div>
                          )}
                        </td>
                        <td>
                          {(proxy.account_count || 0) > 0 ? (
                            <span style={{ fontSize: '0.85rem' }}>
                              <strong>{proxy.account_count}</strong> tài khoản
                              <div 
                                style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.1rem', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} 
                                title={proxy.accounts?.map((a: string) => `@${a}`).join(', ')}
                              >
                                {proxy.accounts?.map((a: string) => `@${a}`).join(', ')}
                              </div>
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Chưa dùng</span>
                          )}
                        </td>
                        <td className="text-right">
                          <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => handleCheckProxyLive(proxy.id)}
                              style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', backgroundColor: 'transparent' }}
                              disabled={loading}
                            >
                              Kiểm tra
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger"
                              onClick={() => handleDeleteProxy(proxy.id)}
                              style={{ 
                                padding: '0.25rem 0.5rem', 
                                fontSize: '0.8rem', 
                                backgroundColor: 'transparent', 
                                border: '1px solid var(--color-danger)', 
                                color: 'var(--color-danger)' 
                              }}
                              disabled={loading}
                            >
                              Xóa
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Cookie Import Modal */}
      {cookieModalAccountId !== null && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1rem'
        }}>
          <div style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            width: '100%',
            maxWidth: '560px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
            padding: '1.5rem',
            position: 'relative'
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.25rem' }}>🍪</span>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>
                  Nhập Cookie / Session cho @{accounts.find(a => a.id === cookieModalAccountId)?.username} ({accounts.find(a => a.id === cookieModalAccountId)?.platform?.toUpperCase()})
                </h3>
              </div>
              <button
                type="button"
                onClick={handleCloseCookieModal}
                disabled={cookieModalLoading}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '1.25rem',
                  lineHeight: 1,
                  padding: '0.2rem 0.5rem'
                }}
              >
                &times;
              </button>
            </div>

            {/* Helper tips */}
            <div style={{
              backgroundColor: 'rgba(59, 130, 246, 0.08)',
              border: '1px solid rgba(59, 130, 246, 0.2)',
              borderRadius: '6px',
              padding: '0.75rem 1rem',
              marginBottom: '1rem',
              fontSize: '0.8rem',
              lineHeight: 1.5,
              color: 'var(--text-secondary)'
            }}>
              <strong style={{ color: '#60a5fa', display: 'block', marginBottom: '0.25rem' }}>💡 Hướng dẫn lấy Cookie nhanh:</strong>
              <div>1. Cài tiện ích <strong>Cookie-Editor</strong> trên Chrome/Edge.</div>
              <div>2. Mở tab Facebook (hoặc MXH tương ứng) đã đăng nhập trên máy của bạn.</div>
              <div>3. Mở Cookie-Editor &gt; Bấm <strong>Export</strong> &gt; Chọn <strong>Export as JSON</strong> (hoặc Header String).</div>
              <div>4. Dán toàn bộ vào khung dưới và bấm <strong>Lưu &amp; Kiểm tra</strong>.</div>
            </div>

            {/* Error / Success Alerts */}
            {cookieModalError && (
              <div className="alert alert-error" style={{ marginBottom: '1rem', padding: '0.6rem 0.8rem', fontSize: '0.85rem' }}>
                <span>⚠️ {cookieModalError}</span>
              </div>
            )}
            {cookieModalSuccess && (
              <div className="alert alert-success" style={{ marginBottom: '1rem', padding: '0.6rem 0.8rem', fontSize: '0.85rem' }}>
                <span>✅ {cookieModalSuccess}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmitCookieImport}>
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                  Dán Cookie (JSON hoặc chuỗi Header c_user=...; xs=...;):
                </label>
                <textarea
                  className="input"
                  rows={6}
                  value={cookieModalValue}
                  onChange={(e) => setCookieModalValue(e.target.value)}
                  placeholder={`Ví dụ:\nc_user=100012345678; xs=38%3Afje8943...; datr=...; sb=...\n\nhoặc mảng JSON từ Cookie-Editor:\n[{"name":"c_user","value":"100012345678",...}]`}
                  style={{
                    width: '100%',
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    padding: '0.6rem 0.75rem',
                    resize: 'vertical',
                    backgroundColor: 'var(--bg-secondary)',
                    borderRadius: '6px'
                  }}
                  disabled={cookieModalLoading}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleCloseCookieModal}
                  disabled={cookieModalLoading}
                  style={{ padding: '0.45rem 1rem', fontSize: '0.85rem' }}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={cookieModalLoading || !cookieModalValue.trim()}
                  style={{ padding: '0.45rem 1.25rem', fontSize: '0.85rem' }}
                >
                  {cookieModalLoading ? '⏳ Đang nạp & Kiểm tra...' : '🚀 Lưu & Kiểm tra LIVE'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
