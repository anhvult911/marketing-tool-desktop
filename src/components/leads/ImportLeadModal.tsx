import React, { useState } from 'react';

interface ImportLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onOpenScrapeDrawer: () => void;
}

export default function ImportLeadModal({
  isOpen,
  onClose,
  onSuccess,
  onOpenScrapeDrawer
}: ImportLeadModalProps) {
  const [importMode, setImportMode] = useState<'file' | 'manual'>('file');
  const [customSource, setCustomSource] = useState('');
  const [rawLeads, setRawLeads] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  if (!isOpen) return null;

  const uploadLeadFile = async (file: File) => {
    if (!file) return;
    setLoading(true);
    setError('');
    setSuccessMsg('');
    const formData = new FormData();
    formData.append('file', file);
    if (customSource.trim()) {
      formData.append('source', customSource.trim());
    } else {
      const autoName = `Tap_Leads_${new Date().toISOString().slice(0,10).replace(/-/g,'')}_${Math.floor(Math.random()*1000)}`;
      formData.append('source', autoName);
    }

    try {
      const res = await fetch('/api/spam/leads', {
        method: 'POST',
        body: formData
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (data.success) {
        setSuccessMsg(data.message || 'Đã nạp Tập Leads thành công!');
        setRawLeads('');
        setCustomSource('');
        onSuccess();
        setTimeout(() => {
          setSuccessMsg('');
          onClose();
        }, 1200);
      } else {
        setError(data.error || 'Có lỗi xảy ra khi nạp dữ liệu.');
      }
    } catch (err: any) {
      setError(err.message || 'Lỗi mạng kết nối máy chủ.');
    } finally {
      setLoading(false);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawLeads.trim()) {
      setError('Vui lòng nhập nội dung mục tiêu.');
      return;
    }
    setLoading(true);
    setError('');
    setSuccessMsg('');

    const sourceName = customSource.trim() || `Tap_Leads_${new Date().toISOString().slice(0,10).replace(/-/g,'')}_${Math.floor(Math.random()*1000)}`;

    try {
      const res = await fetch('/api/spam/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: rawLeads, source: sourceName })
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (data.success) {
        setSuccessMsg(data.message || 'Đã nạp Tập Leads thành công!');
        setRawLeads('');
        setCustomSource('');
        onSuccess();
        setTimeout(() => {
          setSuccessMsg('');
          onClose();
        }, 1200);
      } else {
        setError(data.error || 'Có lỗi xảy ra khi nạp dữ liệu.');
      }
    } catch (err: any) {
      setError(err.message || 'Lỗi kết nối máy chủ.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.75)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '1rem' }}>
      <div className="card" style={{ width: '100%', maxWidth: '600px', padding: '1.75rem', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            📥 Nạp & Thu Thập Tập Leads Mới
          </h3>
          <button 
            type="button" 
            onClick={onClose} 
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '1.2rem', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        {error && (
          <div style={{ padding: '0.75rem 1rem', backgroundColor: 'rgba(248,81,73,0.15)', border: '1px solid var(--color-danger)', borderRadius: '6px', color: 'var(--color-danger)', fontSize: '0.8rem', marginBottom: '1rem' }}>
            ⚠️ {error}
          </div>
        )}

        {successMsg && (
          <div style={{ padding: '0.75rem 1rem', backgroundColor: 'rgba(63,185,80,0.15)', border: '1px solid var(--color-success)', borderRadius: '6px', color: 'var(--color-success)', fontSize: '0.8rem', marginBottom: '1rem' }}>
            ✓ {successMsg}
          </div>
        )}

        {/* Name input */}
        <div className="form-group" style={{ marginBottom: '1.25rem' }}>
          <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>
            Tên Tập Leads / Bộ sưu tập:
          </label>
          <input
            type="text"
            className="form-input"
            placeholder="Ví dụ: Tap_Khach_Hang_BDS_Q3 (Nếu bỏ trống hệ thống tự sinh tên)"
            value={customSource}
            onChange={(e) => setCustomSource(e.target.value)}
            style={{ width: '100%', fontSize: '0.85rem' }}
          />
        </div>

        {/* Mode Selector Tabs */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
          <button 
            type="button"
            onClick={() => setImportMode('file')}
            className={"btn " + (importMode === 'file' ? 'btn-primary' : 'btn-secondary')}
            style={{ fontSize: '0.78rem', padding: '0.35rem 0.85rem' }}
          >
            📁 Nạp qua Tệp CSV / TXT
          </button>
          <button 
            type="button"
            onClick={() => setImportMode('manual')}
            className={"btn " + (importMode === 'manual' ? 'btn-primary' : 'btn-secondary')}
            style={{ fontSize: '0.78rem', padding: '0.35rem 0.85rem' }}
          >
            ✍️ Nhập Văn Bản Thô
          </button>
          <button 
            type="button"
            onClick={() => {
              onClose();
              onOpenScrapeDrawer();
            }}
            className="btn btn-secondary"
            style={{ fontSize: '0.78rem', padding: '0.35rem 0.85rem', color: 'var(--color-primary-hover)' }}
          >
            🔍 Cào Dữ Liệu Tự Động ➔
          </button>
        </div>

        {importMode === 'file' ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.35rem', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Mẫu tham khảo:</span>
              <a href="/leads_template.csv" download className="btn btn-secondary" style={{ fontSize: '0.68rem', padding: '0.15rem 0.4rem', textDecoration: 'none' }}>
                📄 CSV
              </a>
              <a href="/leads_template.txt" download className="btn btn-secondary" style={{ fontSize: '0.68rem', padding: '0.15rem 0.4rem', textDecoration: 'none' }}>
                📄 TXT
              </a>
            </div>

            <div 
              className={"drag-drop-zone " + (isDragging ? 'active' : '')}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) uploadLeadFile(file);
              }}
              onClick={() => document.getElementById('modal-file-input')?.click()}
              style={{ padding: '1.25rem' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary-hover)" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                <div style={{ textAlign: 'left' }}>
                  <p style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', margin: 0 }}>
                    Kéo thả file CSV / TXT vào đây
                  </p>
                  <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '0.1rem 0 0 0' }}>
                    Tự động phân loại SĐT Zalo/WhatsApp, Username Telegram, UID Facebook
                  </p>
                </div>
              </div>
              <button type="button" className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.35rem 0.85rem' }}>
                📁 Chọn File
              </button>
              <input 
                id="modal-file-input" 
                type="file" 
                accept=".csv,.txt" 
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadLeadFile(file);
                  e.target.value = '';
                }} 
                style={{ display: 'none' }} 
              />
            </div>
          </div>
        ) : (
          <form onSubmit={handleManualSubmit}>
            <textarea
              className="textarea font-mono"
              rows={6}
              placeholder="Dán danh sách mục tiêu tại đây (mỗi dòng một mục tiêu)...&#10;Ví dụ:&#10;84981392369&#10;https://wa.me/84981392369&#10;https://chat.whatsapp.com/InviteCode123&#10;@telegram_username&#10;https://facebook.com/posts/12345678"
              value={rawLeads}
              onChange={(e) => setRawLeads(e.target.value)}
              style={{ width: '100%', fontSize: '0.82rem', background: 'rgba(0,0,0,0.1)', marginBottom: '1rem' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" onClick={onClose} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.45rem 1rem' }}>
                Hủy
              </button>
              <button type="submit" className="btn btn-primary" style={{ fontSize: '0.8rem', padding: '0.45rem 1.5rem' }} disabled={loading}>
                {loading ? 'Đang lưu...' : '⚡ Lưu vào Kho Leads'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
