import React, { useState, useEffect, useCallback, useRef } from 'react';
import LeadTable from '@/components/spam/LeadTable';

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

interface LeadDetailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  collectionName: string;
  /** Tổng số mục của tập (từ API collections) — hiển thị trước khi trang đầu về. */
  collectionTotal?: number;
  onRefresh: () => void;
  onResetLeads: (all: boolean, ids?: number[]) => void;
  onDeleteLead: (id: number) => void;
  /** Đặt lại toàn bộ tập theo nguồn (server-side, không cần tải hết lead về). */
  onResetCollection: (source: string) => void;
  onClearAllLeads: () => void;
  loading: boolean;
}

/**
 * P4 — Drawer tự lấy dữ liệu PHÂN TRANG từ server theo từng tập (source).
 * Trước đây nhận mảng `leads` (tối đa 10k) từ trang cha rồi lọc client-side —
 * kho lớn là treo. Giờ server lọc/phân trang, drawer giữ đúng 1 trang trong RAM.
 */
export default function LeadDetailDrawer({
  isOpen,
  onClose,
  collectionName,
  collectionTotal,
  onRefresh,
  onResetLeads,
  onDeleteLead,
  onResetCollection,
  onClearAllLeads,
  loading
}: LeadDetailDrawerProps) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [leadPage, setLeadPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [leadSearch, setLeadSearch] = useState('');
  const [fetching, setFetching] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<number>>(new Set());

  // Debounce ô tìm kiếm: gõ liên tục không bắn 1 request/ký tự
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(leadSearch), 350);
    return () => clearTimeout(searchTimer.current);
  }, [leadSearch]);

  // Reset khi đổi tập hoặc đóng/mở
  useEffect(() => {
    if (!isOpen) return;
    setLeads([]);
    setTotal(collectionTotal ?? 0);
    setLeadPage(0);
    setLeadSearch('');
    setDebouncedSearch('');
    setSelectedLeadIds(new Set());
  }, [isOpen, collectionName, collectionTotal]);

  const fetchPage = useCallback(async () => {
    if (!isOpen) return;
    setFetching(true);
    try {
      const params = new URLSearchParams({
        source: collectionName,
        page: String(leadPage + 1),
        pageSize: String(pageSize),
      });
      if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim());
      const res = await fetch(`/api/spam/leads?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setLeads(data.data || []);
        setTotal(typeof data.total === 'number' ? data.total : (data.data || []).length);
      }
    } catch (err) {
      console.error('[LeadDetailDrawer] fetch failed:', err);
    } finally {
      setFetching(false);
    }
  }, [isOpen, collectionName, leadPage, pageSize, debouncedSearch]);

  useEffect(() => { fetchPage(); }, [fetchPage]);

  const handleToggleSelectLead = (id: number) => {
    setSelectedLeadIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleSelectAllOnPage = (paginatedLeads: Lead[]) => {
    const pendingOnPage = paginatedLeads.filter(l => l.status === 'pending');
    if (pendingOnPage.length === 0) return;
    const allChecked = pendingOnPage.every(l => selectedLeadIds.has(l.id));
    setSelectedLeadIds(prev => {
      const next = new Set(prev);
      if (allChecked) pendingOnPage.forEach(l => next.delete(l.id));
      else pendingOnPage.forEach(l => next.add(l.id));
      return next;
    });
  };

  const handleSelectAllFiltered = (filteredList: Lead[]) => {
    setSelectedLeadIds(new Set(filteredList.filter(l => l.status === 'pending').map(l => l.id)));
  };

  const handleDeselectAll = () => setSelectedLeadIds(new Set());

  const handleExportCollectionCSV = async () => {
    // Xuất theo TICK CHỌN (đang có trong RAM) hoặc tải cả tập từ server theo trang.
    let exportList: Lead[] = leads.filter(l => selectedLeadIds.has(l.id));
    if (exportList.length === 0) {
      const collected: Lead[] = [];
      const exportPageSize = 5000;
      for (let p = 1; collected.length < total && p <= 20; p++) {
        const params = new URLSearchParams({ source: collectionName, page: String(p), pageSize: String(exportPageSize) });
        if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim());
        const res = await fetch(`/api/spam/leads?${params.toString()}`);
        const data = await res.json();
        if (!data.success || !data.data?.length) break;
        collected.push(...data.data);
        if (data.data.length < exportPageSize) break;
      }
      exportList = collected;
    }
    if (exportList.length === 0) return;

    let csvContent = 'data:text/csv;charset=utf-8,ID,Platform,Value,Source,Status\n';
    exportList.forEach(l => {
      csvContent += `${l.id},"${l.platform}","${l.value}","${l.source || ''}","${l.status}"\n`;
    });

    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `${collectionName.replace(/[^a-zA-Z0-9_-]/g, '_')}_export.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!isOpen) return null;

  const displayTotal = total || collectionTotal || 0;

  return (
    <div className="ux-drawer-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.75)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '1rem' }}>
      <div className="card" style={{ width: '96vw', maxWidth: '1450px', height: '92vh', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '12px', boxShadow: '0 12px 48px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {/* Header */}
        <div style={{ padding: '1.25rem 1.75rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-primary)' }}>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-primary-hover)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              CHI TIẾT BỘ SƯU TẬP LEADS
            </span>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0.1rem 0 0 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              📁 {collectionName} ({displayTotal.toLocaleString('vi-VN')} mục tiêu)
            </h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={() => onResetCollection(collectionName)}
              className="btn btn-secondary"
              style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}
              title="Đặt lại trạng thái toàn bộ tập về Sẵn sàng"
            >
              🔄 Reset cả tập
            </button>
            <button 
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '1.5rem', cursor: 'pointer', padding: '0.2rem 0.5rem' }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Full-width Modal Body */}
        <div style={{ padding: '1.5rem 1.75rem', flex: '1 1 auto', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <LeadTable
            leads={leads}
            selectedLeadIds={selectedLeadIds}
            onToggleSelectLead={handleToggleSelectLead}
            onToggleSelectAllOnPage={handleToggleSelectAllOnPage}
            onSelectAllFiltered={handleSelectAllFiltered}
            onDeselectAll={handleDeselectAll}
            onResetLeads={(all, ids) => {
              // Chọn tick → reset theo ids; không chọn → reset cả tập theo nguồn
              if (!all) return;
              if (selectedLeadIds.size > 0) onResetLeads(false, Array.from(selectedLeadIds));
              else onResetCollection(collectionName);
              setSelectedLeadIds(new Set());
              fetchPage();
              onRefresh();
            }}
            onDeleteLead={async (id) => {
              await onDeleteLead(id);
              fetchPage();
            }}
            onClearAllLeads={() => { onClearAllLeads(); fetchPage(); }}
            loading={loading || fetching}
            leadSearch={leadSearch}
            setLeadSearch={setLeadSearch}
            selectedSourceFilter=""
            setSelectedSourceFilter={() => {}}
            uniqueSources={[]}
            leadPage={leadPage}
            setLeadPage={setLeadPage}
            onExportCSV={handleExportCollectionCSV}
            serverTotal={total}
            serverPageSize={pageSize}
            onPageSizeChange={(n) => { setPageSize(n); setLeadPage(0); }}
          />
        </div>
      </div>
    </div>
  );
}
