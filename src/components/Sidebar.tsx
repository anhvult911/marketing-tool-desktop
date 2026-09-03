'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface UserSession {
  userId: number;
  email: string;
  fullName: string;
  isSuperAdmin: boolean;
  activeWorkspaceId: number;
  role: string;
}

interface SidebarProps {
  onClose?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  user: UserSession | null;
  onLogout: () => void;
}

export default function Sidebar({ onClose, isCollapsed, onToggleCollapse, user, onLogout }: SidebarProps) {
  const pathname = usePathname();

  const menuItems = [
    { name: 'Dashboard', path: '/', icon: '📊' },
    { name: 'Tài khoản & Proxy', path: '/accounts', icon: '🔑' },
    { name: 'Kho bài viết', path: '/library', icon: '📁' },
    { name: 'Kho Leads', path: '/leads', icon: '🎯' },
    { name: 'Đăng bài & Lịch trình', path: '/composer', icon: '📝' },
    { name: 'Spam & Seeding', path: '/spam', icon: '🤖' },
  ];

  if (user && (user.role === 'admin' || user.isSuperAdmin)) {
    menuItems.push({ name: 'Thành viên & Quyền', path: '/members', icon: '👥' });
  }

  const getRoleLabel = (role: string, isSuper: boolean) => {
    if (isSuper) return 'Super Admin';
    if (role === 'admin') return 'Workspace Admin';
    if (role === 'staff') return 'Staff';
    return 'Viewer';
  };

  return (
    <aside className="sidebar">
      <style dangerouslySetInnerHTML={{ __html: `
        .sidebar-user-section {
          padding: 1rem;
          border-top: 1px solid var(--border-color);
          margin-top: auto;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          background: rgba(13, 17, 23, 0.4);
        }
        
        .sidebar-user-info {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          overflow: hidden;
        }

        .sidebar-user-name {
          font-size: 0.9rem;
          font-weight: 600;
          color: var(--text-primary);
          white-space: nowrap;
          text-overflow: ellipsis;
          overflow: hidden;
        }

        .sidebar-user-role {
          font-size: 0.75rem;
          color: var(--color-primary-hover);
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .sidebar-logout-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          width: 100%;
          padding: 0.5rem;
          background: transparent;
          border: 1px solid var(--border-color);
          border-radius: 6px;
          color: var(--color-danger);
          font-size: 0.85rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .sidebar-logout-btn:hover {
          background: var(--color-danger-glow);
          border-color: var(--color-danger);
        }

        .sidebar-collapsed .sidebar-user-info {
          display: none;
        }

        .sidebar-collapsed .sidebar-logout-btn span {
          display: none;
        }
        
        .sidebar-collapsed .sidebar-logout-btn {
          border: none;
          font-size: 1.1rem;
        }
      ` }} />

      <div className="sidebar-brand">
        🚀 <span>{!isCollapsed && 'MKT Tools'}</span>
      </div>
      <ul className="sidebar-menu">
        {menuItems.map((item) => {
          const isActive = pathname === item.path;
          return (
            <li
              key={item.path}
              className={`sidebar-item ${isActive ? 'active' : ''}`}
              onClick={onClose}
              title={isCollapsed ? item.name : undefined}
            >
              <Link href={item.path}>
                <span>{item.icon}</span>
                {!isCollapsed && item.name}
              </Link>
            </li>
          );
        })}
      </ul>



      {/* Collapse/Expand toggle button */}
      {onToggleCollapse && (
        <button
          className="sidebar-toggle-btn hide-on-mobile"
          onClick={onToggleCollapse}
          aria-label={isCollapsed ? 'Mở rộng menu' : 'Thu gọn menu'}
          type="button"
        >
          {isCollapsed ? '›' : '‹'}
        </button>
      )}
    </aside>
  );
}
