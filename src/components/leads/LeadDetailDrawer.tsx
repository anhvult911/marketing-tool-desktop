import React, { useState } from 'react';
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
  leads: Lead[];
  onRefresh: () => void;
  onResetLeads: (all: boolean, ids?: number[]) => void;
  onDeleteLead: (id: number) => void;
  onClearAllLeads: () => void;
  loading: boolean;
}

export default function LeadDetailDrawer({
  isOpen,
  onClose,
  collectionName,
  leads,
  onRefresh,
  onResetLeads,
  onDeleteLead,
  onClearAllLeads,
  loading
}: LeadDetailDrawerProps) {
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<number>>(new Set());
  const [leadSearch, setLeadSearch] = useState('');
  const [leadPage, setLeadPage] = useState(0);

  if (!isOpen) return null;

  const collectionLeads = leads.filter(l => (l.source || 'Danh_Sach_Thủ_Công') === collectionName);

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
      if (allChecked) {
        pendingOnPage.forEach(l => next.delete(l.id));
      } else {
        pendingOnPage.forEach(l => next.add(l.id));
      }
      return next;
    });
  };

  const handleSelectAllFiltered = (filteredList: Lead[]) => {
    const pendingIds = filteredList.filter(l => l.status === 'pending').map(l => l.id);
    setSelectedLeadIds(new Set(pendingIds));
  };

  const handleDeselectAll = () => {
    setSelectedLeadIds(new Set());
  };

  const handleExportCollectionCSV = () => {
    if (collectionLeads.length === 0) return;
    let exportList = collectionLeads;
    if (selectedLeadIds.size > 0) {
      exportList = collectionLeads.filter(l => selectedLeadIds.has(l.id));
    }
    
    let csvContent = 'data:text/csv;charset=utf-8,ID,Platform,Value,Source,Status\n';
    exportList.forEach(l => {
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
    <div className="ux-drawer-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.75)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '1rem' }}>
      <div className="card" style={{ width: '96vw', maxWidth: '1450px', height: '92vh', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '12px', boxShadow: '0 12px 48px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {/* Header */}
        <div style={{ padding: '1.25rem 1.75rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-primary)' }}>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-primary-hover)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              CHI TIẾT BỘ SƯU TẬP LEADS
            </span>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0.1rem 0 0 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              📁 {collectionName} ({collectionLeads.length} mục tiêu)
            </h2>
          </div>
          <button 
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '1.5rem', cursor: 'pointer', padding: '0.2rem 0.5rem' }}
          >
            ✕
          </button>
        </div>

        {/* Full-width Modal Body */}
        <div style={{ padding: '1.5rem 1.75rem', flex: '1 1 auto', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <LeadTable
            leads={collectionLeads}
            selectedLeadIds={selectedLeadIds}
            onToggleSelectLead={handleToggleSelectLead}
            onToggleSelectAllOnPage={handleToggleSelectAllOnPage}
            onSelectAllFiltered={handleSelectAllFiltered}
            onDeselectAll={handleDeselectAll}
            onResetLeads={onResetLeads}
            onDeleteLead={onDeleteLead}
            onClearAllLeads={onClearAllLeads}
            loading={loading}
            leadSearch={leadSearch}
            setLeadSearch={setLeadSearch}
            selectedSourceFilter=""
            setSelectedSourceFilter={() => {}}
            uniqueSources={[]}
            leadPage={leadPage}
            setLeadPage={setLeadPage}
            onExportCSV={handleExportCollectionCSV}
          />
        </div>
      </div>
    </div>
  );
}
