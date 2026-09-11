'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Sidebar, { UserSession } from './Sidebar';
import { UpdateToast, ForceUpdateModal, VersionPanel } from './UpdateManager';

interface Workspace {
  id: number;
  name: string;
  subscription_plan: string;
  owner_name: string;
  role: string;
}

export function getInitials(name: string | null | undefined): string {
  if (!name || typeof name !== 'string') return 'U';
  try {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'U';
    const initials = parts.map(p => p[0]).join('').substring(0, 2).toUpperCase();
    return initials || 'U';
  } catch (err) {
    console.error('Error generating initials:', err);
    return 'U';
  }
}

const DEFAULT_USER: UserSession = {
  userId: 1,
  email: 'admin@desktop.local',
  fullName: 'Desktop Admin',
  isSuperAdmin: true,
  activeWorkspaceId: 1,
  role: 'admin',
};

const DEFAULT_WORKSPACES: Workspace[] = [
  {
    id: 1,
    name: 'Workspace Mặc định',
    subscription_plan: 'Desktop Local',
    owner_name: 'Local Admin',
    role: 'admin',
  }
];

export default function ResponsiveLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isAuthPage = pathname === '/login' || pathname === '/register';
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  
  // User auth states
  const [user, setUser] = useState<UserSession | null>(DEFAULT_USER);
  const [workspaces, setWorkspaces] = useState<Workspace[]>(DEFAULT_WORKSPACES);
  const [loading, setLoading] = useState(false);
  const [showWorkspaceDropdown, setShowWorkspaceDropdown] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);

  // Profile Modal states
  const [profileFullName, setProfileFullName] = useState('');
  const [profileCurrentPassword, setProfileCurrentPassword] = useState('');
  const [profileNewPassword, setProfileNewPassword] = useState('');
  const [profileConfirmPassword, setProfileConfirmPassword] = useState('');
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [profileSubmitting, setProfileSubmitting] = useState(false);

  // Workspace settings state
  const [workspaceApiKey, setWorkspaceApiKey] = useState('');
  const [loadingApiKey, setLoadingApiKey] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);

  const handleRestoreBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!confirm('Hành động này sẽ ghi đè CSDL và các phiên đăng nhập hiện tại bằng bản sao lưu. Bạn có chắc chắn muốn tiếp tục?')) {
      e.target.value = '';
      return;
    }

    setRestoringBackup(true);
    setProfileError('');
    setProfileSuccess('');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/workspace/backup', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (data.success) {
        setProfileSuccess(data.message || 'Khôi phục dữ liệu thành công!');
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        setProfileError(data.error || 'Khôi phục thất bại.');
      }
    } catch (err: any) {
      setProfileError('Lỗi kết nối khi gửi bản sao lưu: ' + err.message);
    } finally {
      setRestoringBackup(false);
      e.target.value = '';
    }
  };

  useEffect(() => {
    if (user) {
      setProfileFullName(user.fullName);
    }
  }, [user]);

  useEffect(() => {
    if (showProfileModal && user && (user.role === 'admin' || user.isSuperAdmin)) {
      setLoadingApiKey(true);
      fetch('/api/workspace/settings')
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setWorkspaceApiKey(data.gemini_api_key || '');
          }
        })
        .catch(err => console.error(err))
        .finally(() => setLoadingApiKey(false));
    }
  }, [showProfileModal, user]);

  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.workspace-selector-container')) {
        setShowWorkspaceDropdown(false);
      }
      if (!target.closest('.user-dropdown-container')) {
        setShowUserDropdown(false);
      }
    };

    document.addEventListener('click', handleDocumentClick);
    return () => document.removeEventListener('click', handleDocumentClick);
  }, []);

  useEffect(() => {
    if (isAuthPage) return;

    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.user) {
          setUser(data.user);
        }
      })
      .catch((err) => console.warn('[Auth] Background sync user:', err));

    fetch('/api/auth/workspaces')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.workspaces) {
          setWorkspaces(data.workspaces);
        }
      })
      .catch((err) => console.warn('[Auth] Background sync workspaces:', err));
  }, [isAuthPage]);

  const handleLogout = async () => {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (res.ok) {
        router.push('/login');
        router.refresh();
      }
    } catch (err) {
      console.error('Error logging out:', err);
    }
  };

  const handleSwitchWorkspace = async (workspaceId: number) => {
    try {
      const res = await fetch('/api/auth/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });

      if (res.ok) {
        setShowWorkspaceDropdown(false);
        // Refresh page to load new workspace data
        window.location.reload();
      } else {
        alert('Không thể chuyển đổi Workspace.');
      }
    } catch (err) {
      console.error('Error switching workspace:', err);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess('');

    if (!profileFullName.trim()) {
      setProfileError('Họ tên không được để trống.');
      return;
    }

    if (profileNewPassword) {
      if (!profileCurrentPassword) {
        setProfileError('Vui lòng nhập mật khẩu hiện tại để thay đổi mật khẩu mới.');
        return;
      }
      if (profileNewPassword.length < 6) {
        setProfileError('Mật khẩu mới phải có ít nhất 6 ký tự.');
        return;
      }
      if (profileNewPassword !== profileConfirmPassword) {
        setProfileError('Xác nhận mật khẩu mới không khớp.');
        return;
      }
    }

    setProfileSubmitting(true);
    try {
      // 1. Update Profile (FullName/Password)
      const res = await fetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: profileFullName,
          currentPassword: profileCurrentPassword || undefined,
          newPassword: profileNewPassword || undefined
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setProfileError(data.error || 'Cập nhật thất bại.');
        setProfileSubmitting(false);
        return;
      }

      // 2. Update Gemini API Key (if admin/superAdmin)
      if (user && (user.role === 'admin' || user.isSuperAdmin)) {
        const apiKeyRes = await fetch('/api/workspace/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gemini_api_key: workspaceApiKey })
        });
        const apiKeyData = await apiKeyRes.json();
        if (!apiKeyRes.ok) {
          setProfileError(apiKeyData.error || 'Cập nhật API Key thất bại.');
          setProfileSubmitting(false);
          return;
        }
      }

      setProfileSuccess('Cập nhật tài khoản và cấu hình thành công!');
      setUser(prev => prev ? { ...prev, fullName: profileFullName.trim() } : null);
      setProfileCurrentPassword('');
      setProfileNewPassword('');
      setProfileConfirmPassword('');
      setTimeout(() => {
        setShowProfileModal(false);
        setProfileSuccess('');
      }, 1500);
    } catch (err) {
      setProfileError('Lỗi kết nối máy chủ.');
    } finally {
      setProfileSubmitting(false);
    }
  };

  const handleHamburgerClick = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 992) {
      setIsSidebarOpen(!isSidebarOpen);
    } else {
      setIsCollapsed(!isCollapsed);
    }
  };

  const activeWorkspace = workspaces.find((w) => w.id === user?.activeWorkspaceId);

  if (isAuthPage) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="layout-loader">
        <style dangerouslySetInnerHTML={{ __html: `
          .layout-loader {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100vw;
            height: 100vh;
            background-color: #0d1117;
            color: #f0f6fc;
            font-size: 1.1rem;
            font-weight: 500;
          }
          .spinner {
            width: 24px;
            height: 24px;
            border: 3px solid rgba(255, 255, 255, 0.1);
            border-top: 3px solid #2f81f7;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin-right: 12px;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        ` }} />
        <div className="spinner" /> Đang tải hệ thống...
      </div>
    );
  }

  return (
    <div className={`app-container ${isCollapsed ? 'sidebar-collapsed' : ''}`}>
      <style dangerouslySetInnerHTML={{ __html: `
        .workspace-selector-container {
          position: relative;
        }

        .workspace-btn {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 0.5rem 0.85rem;
          color: var(--text-primary);
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .workspace-btn:hover {
          background: #30363d;
          border-color: #8b949e;
        }

        .workspace-dropdown {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.5);
          width: 260px;
          z-index: 100;
          overflow: hidden;
          animation: slideDown 0.15s ease-out;
        }

        .workspace-dropdown-header {
          padding: 0.75rem 1rem;
          font-size: 0.75rem;
          color: var(--text-secondary);
          text-transform: uppercase;
          border-bottom: 1px solid var(--border-color);
          font-weight: 600;
        }

        .workspace-list {
          list-style: none;
          max-height: 240px;
          overflow-y: auto;
        }

        .workspace-item {
          padding: 0.75rem 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
          cursor: pointer;
          transition: background-color 0.15s;
          border-bottom: 1px solid rgba(48, 54, 61, 0.5);
        }

        .workspace-item:last-child {
          border-bottom: none;
        }

        .workspace-item:hover {
          background: var(--bg-tertiary);
        }

        .workspace-item.active {
          background: rgba(47, 129, 247, 0.15);
          border-left: 3px solid var(--color-primary);
        }

        .workspace-item-name {
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--text-primary);
        }

        .workspace-item-details {
          display: flex;
          justify-content: space-between;
          font-size: 0.7rem;
          color: var(--text-secondary);
        }

        .workspace-badge {
          background: rgba(47, 129, 247, 0.2);
          color: var(--color-primary-hover);
          padding: 1px 6px;
          border-radius: 4px;
          text-transform: uppercase;
          font-size: 0.65rem;
          font-weight: 600;
        }

        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* User Profile Header Avatar */
        .user-avatar-header {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-weight: 700;
          font-size: 0.8rem;
          cursor: pointer;
          border: 2px solid rgba(255, 255, 255, 0.1);
          transition: all 0.2s ease;
          background: linear-gradient(135deg, #1fa2ff, #12d6df, #00ff87);
          box-shadow: 0 0 8px rgba(18, 214, 223, 0.2);
        }

        .user-avatar-header:hover {
          transform: scale(1.05);
          box-shadow: 0 0 12px rgba(18, 214, 223, 0.4);
          border-color: #fff;
        }

        .user-dropdown-container {
          position: relative;
          display: inline-block;
        }

        .user-dropdown-menu {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.5);
          width: 220px;
          z-index: 1000;
          overflow: hidden;
          padding: 8px 0;
          animation: slideDown 0.15s ease-out;
        }

        .user-dropdown-profile {
          padding: 10px 16px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .user-dropdown-name {
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--text-primary);
          white-space: nowrap;
          text-overflow: ellipsis;
          overflow: hidden;
        }

        .user-dropdown-username {
          font-size: 0.75rem;
          color: var(--text-secondary);
          white-space: nowrap;
          text-overflow: ellipsis;
          overflow: hidden;
        }

        .user-dropdown-divider {
          border: none;
          border-top: 1px solid var(--border-color);
          margin: 6px 0;
        }

        .user-dropdown-item {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 8px 16px;
          background: transparent;
          border: none;
          color: var(--text-secondary);
          font-size: 0.8rem;
          font-weight: 500;
          cursor: pointer;
          text-align: left;
          transition: all 0.2s;
        }

        .user-dropdown-item:hover {
          background: var(--bg-tertiary);
          color: var(--text-primary);
        }

        .user-dropdown-item.logout {
          color: var(--color-danger);
        }

        .user-dropdown-item.logout:hover {
          background: var(--color-danger-glow);
          color: #ff7b72;
        }

        /* Modals & Dialogs Premium styling */
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(10, 12, 16, 0.85);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          padding: 1rem;
          animation: fadeIn 0.2s ease-out;
        }

        .modal-content {
          background: var(--bg-surface);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid var(--border-subtle);
          border-radius: 16px;
          width: 100%;
          max-width: 520px;
          max-height: 90vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6), 0 0 40px rgba(47, 129, 247, 0.03);
          overflow: hidden;
          animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .modal-content form {
          display: flex;
          flex-direction: column;
          flex: 1;
          overflow: hidden;
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1.25rem 1.5rem;
          border-bottom: 1px solid var(--border-subtle);
        }

        .modal-title {
          font-size: 1.15rem;
          font-weight: 700;
          color: var(--text-primary);
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .modal-close-btn {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          font-size: 1.5rem;
          cursor: pointer;
          transition: all 0.2s ease;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          border-radius: 50%;
        }

        .modal-close-btn:hover {
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-primary);
        }

        .modal-body {
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          flex: 1;
          overflow-y: auto;
        }

        .modal-footer {
          display: flex;
          justify-content: flex-end;
          gap: 0.75rem;
          padding: 1rem 1.5rem;
          background: rgba(0, 0, 0, 0.25);
          border-top: 1px solid var(--border-subtle);
        }

        /* Form elements inside modals */
        .form-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .form-label {
          font-size: 0.75rem;
          font-weight: 700;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .form-input {
          background: rgba(13, 17, 23, 0.6);
          border: 1px solid var(--border-color);
          color: var(--text-primary);
          border-radius: 8px;
          padding: 0.65rem 0.85rem;
          font-size: 0.95rem;
          font-family: inherit;
          transition: all 0.2s ease;
          width: 100%;
        }

        .form-input:focus {
          border-color: var(--color-primary);
          box-shadow: 0 0 0 3px rgba(47, 129, 247, 0.15);
          outline: none;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        .btn-gradient {
          background: linear-gradient(135deg, var(--color-primary) 0%, #0072ff 100%);
          color: #ffffff;
          border: none;
          box-shadow: 0 4px 14px rgba(47, 129, 247, 0.3);
        }

        .btn-gradient:hover {
          background: linear-gradient(135deg, var(--color-primary-hover) 0%, #0088ff 100%);
          transform: translateY(-1px);
        }

        .btn-gradient:active {
          transform: translateY(1px);
        }
      ` }} />

      {/* Sidebar Wrapper (handles responsive styling & backdrop) */}
      <div className={`sidebar-wrapper ${isSidebarOpen ? 'open' : ''}`}>
        <Sidebar 
          onClose={() => setIsSidebarOpen(false)} 
          isCollapsed={isCollapsed}
          onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
          user={user}
          onLogout={handleLogout}
        />
        {isSidebarOpen && (
          <div 
            className="sidebar-backdrop" 
            onClick={() => setIsSidebarOpen(false)} 
          />
        )}
      </div>

      <div className="main-wrapper">
        <header className="header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button 
              className="hamburger-btn"
              onClick={handleHamburgerClick}
              aria-label="Toggle Menu"
              type="button"
            >
              ☰
            </button>
            <div className="header-title">
              <h1>Marketing Automation</h1>
            </div>
          </div>
          <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {/* Workspace Selector */}
            {user && (
              <div className="workspace-selector-container">
                {workspaces.length > 1 ? (
                  <>
                    <button 
                      className="workspace-btn"
                      onClick={() => setShowWorkspaceDropdown(!showWorkspaceDropdown)}
                      type="button"
                    >
                      🏢 {activeWorkspace ? activeWorkspace.name : 'Chọn Workspace'} ▾
                    </button>
                    {showWorkspaceDropdown && (
                      <div className="workspace-dropdown">
                        <div className="workspace-dropdown-header">Không gian làm việc</div>
                        <ul className="workspace-list">
                          {workspaces.map((ws) => (
                            <li 
                              key={ws.id}
                              className={`workspace-item ${ws.id === user.activeWorkspaceId ? 'active' : ''}`}
                              onClick={() => handleSwitchWorkspace(ws.id)}
                            >
                              <span className="workspace-item-name">{ws.name}</span>
                              <div className="workspace-item-details">
                                <span>Vai trò: {ws.role}</span>
                                <span className="workspace-badge">{ws.subscription_plan}</span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="workspace-btn" style={{ cursor: 'default', pointerEvents: 'none' }}>
                    🏢 {activeWorkspace ? activeWorkspace.name : 'Default Workspace'}
                  </div>
                )}
              </div>
            )}


            {/* User Profile Avatar Dropdown */}
            {user && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div className="user-dropdown-container">
                  <button 
                    className="user-avatar-header"
                    onClick={() => setShowUserDropdown(!showUserDropdown)}
                    title="Cài đặt cá nhân"
                    type="button"
                  >
                    {getInitials(user.fullName)}
                  </button>
                  {showUserDropdown && (
                    <div className="user-dropdown-menu">
                      <div className="user-dropdown-profile">
                        <div className="user-dropdown-name" title={user.fullName}>{user.fullName}</div>
                        <div className="user-dropdown-username" title={user.email} style={{ marginBottom: '8px' }}>@{user.email}</div>
                        <div style={{ display: 'inline-block', width: 'fit-content' }}>
                          <span className={`role-badge-header`} style={{
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            padding: '3px 8px',
                            borderRadius: '8px',
                            background: user.isSuperAdmin 
                              ? 'linear-gradient(135deg, #FF8008, #FFC837)' 
                              : user.role === 'admin' 
                                ? 'rgba(47, 129, 247, 0.15)' 
                                : user.role === 'staff' 
                                  ? 'rgba(56, 239, 125, 0.15)' 
                                  : 'rgba(139, 148, 158, 0.15)',
                            color: user.isSuperAdmin 
                              ? '#fff' 
                              : user.role === 'admin' 
                                ? '#58a6ff' 
                                : user.role === 'staff' 
                                  ? '#57f287' 
                                  : '#8b949e',
                            border: user.isSuperAdmin 
                              ? '1px solid #FFC837' 
                              : user.role === 'admin' 
                                ? '1px solid rgba(47, 129, 247, 0.3)' 
                                : user.role === 'staff' 
                                  ? '1px solid rgba(56, 239, 125, 0.3)' 
                                  : '1px solid rgba(139, 148, 158, 0.3)',
                            whiteSpace: 'nowrap',
                            letterSpacing: '0.5px'
                          }}>
                            {user.isSuperAdmin 
                              ? '👑 Super Admin' 
                              : user.role === 'admin' 
                                ? '👤 Workspace Admin' 
                                : user.role === 'staff' 
                                  ? '🔧 Staff' 
                                  : '👁️ Viewer'}
                          </span>
                        </div>
                      </div>
                      <hr className="user-dropdown-divider" />
                      <button className="user-dropdown-item" onClick={() => { setShowUserDropdown(false); setShowProfileModal(true); }}>
                        👤 Thiết lập tài khoản
                      </button>
                      <button className="user-dropdown-item logout" onClick={handleLogout}>
                        🚪 Đăng xuất
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </header>
        <main className="content-body">
          {children}
        </main>
      </div>

      {/* CẬP NHẬT PHIÊN BẢN: banner có bản mới + popup bắt buộc cập nhật */}
      <UpdateToast />
      <ForceUpdateModal />

      {/* PROFILE SETTINGS MODAL */}
      {showProfileModal && user && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title">👤 Thiết lập tài khoản cá nhân</h3>
              <button className="modal-close-btn" onClick={() => setShowProfileModal(false)}>×</button>
            </div>
            <form onSubmit={handleUpdateProfile}>
              <div className="modal-body">
                {profileError && (
                  <div className="alert alert-danger" style={{ marginBottom: '15px', background: 'rgba(217, 83, 79, 0.1)', color: '#ff6b6b', padding: '10px 12px', borderRadius: '6px', fontSize: '0.85rem', border: '1px solid rgba(217, 83, 79, 0.2)' }}>
                    {profileError}
                  </div>
                )}
                {profileSuccess && (
                  <div className="alert alert-success" style={{ marginBottom: '15px', background: 'rgba(92, 184, 92, 0.1)', color: '#5cb85c', padding: '10px 12px', borderRadius: '6px', fontSize: '0.85rem', border: '1px solid rgba(92, 184, 92, 0.2)' }}>
                    {profileSuccess}
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">Tên đăng nhập (Username)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={user.email}
                    disabled
                    style={{ cursor: 'not-allowed', opacity: 0.6 }}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Họ tên của bạn</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Nguyễn Văn A"
                    value={profileFullName}
                    onChange={(e) => setProfileFullName(e.target.value)}
                    disabled={profileSubmitting}
                    required
                  />
                </div>

                <hr style={{ border: 'none', borderTop: '1px solid rgba(255, 255, 255, 0.1)', margin: '20px 0' }} />
                <h4 style={{ fontSize: '14px', color: '#fff', marginBottom: '10px' }}>🔐 Thay đổi mật khẩu</h4>

                <div className="form-group">
                  <label className="form-label">Mật khẩu hiện tại</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="••••••••"
                    value={profileCurrentPassword}
                    onChange={(e) => setProfileCurrentPassword(e.target.value)}
                    disabled={profileSubmitting}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Mật khẩu mới (Tối thiểu 6 ký tự)</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="••••••••"
                    value={profileNewPassword}
                    onChange={(e) => setProfileNewPassword(e.target.value)}
                    disabled={profileSubmitting}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Xác nhận mật khẩu mới</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="••••••••"
                    value={profileConfirmPassword}
                    onChange={(e) => setProfileConfirmPassword(e.target.value)}
                    disabled={profileSubmitting}
                  />
                </div>

                {(user.role === 'admin' || user.isSuperAdmin) && (
                  <>
                    <hr style={{ border: 'none', borderTop: '1px solid rgba(255, 255, 255, 0.1)', margin: '20px 0' }} />
                    <h4 style={{ fontSize: '14px', color: '#fff', marginBottom: '6px' }}>🔄 Phiên bản & Cập nhật ứng dụng</h4>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
                      Ứng dụng tự kiểm tra bản mới khi khởi động và mỗi 2 giờ. Khi bản hiện tại thấp hơn mức tối thiểu
                      mà nhà phát hành yêu cầu, hệ thống sẽ yêu cầu cập nhật trước khi tiếp tục sử dụng.
                    </p>
                    <VersionPanel />

                    <hr style={{ border: 'none', borderTop: '1px solid rgba(255, 255, 255, 0.1)', margin: '20px 0' }} />
                    <h4 style={{ fontSize: '14px', color: '#fff', marginBottom: '10px' }}>🏢 Cấu hình Workspace (Chỉ dành cho Admin)</h4>
                    <div className="form-group">
                      <label className="form-label">Gemini API Key (Dùng cho tính năng tối ưu bằng AI)</label>
                      <input
                        type="password"
                        className="form-input"
                        placeholder={loadingApiKey ? "Đang tải cấu hình..." : "Nhập Gemini API Key..."}
                        value={workspaceApiKey}
                        onChange={(e) => setWorkspaceApiKey(e.target.value)}
                        disabled={profileSubmitting || loadingApiKey}
                      />
                      <small style={{ display: 'block', marginTop: '0.25rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        Cấu hình API Key cho Workspace này để kích hoạt chức năng viết lại và tối ưu hóa nội dung bằng AI. Để trống sẽ dùng cấu hình mặc định .env của hệ thống.
                      </small>
                    </div>

                    <hr style={{ border: 'none', borderTop: '1px solid rgba(255, 255, 255, 0.1)', margin: '20px 0' }} />
                    <h4 style={{ fontSize: '14px', color: '#fff', marginBottom: '8px' }}>💾 Sao lưu & Phục hồi Toàn bộ Dữ liệu</h4>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
                      Xuất toàn bộ CSDL SQLite (tài khoản, proxy, kịch bản, leads) và các phiên đăng nhập profile để phòng ngừa mất dữ liệu hoặc chuyển sang máy tính khác.
                    </p>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      <a
                        href="/api/workspace/backup"
                        download
                        className="btn btn-secondary"
                        style={{ textDecoration: 'none', padding: '0.45rem 0.85rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                      >
                        📦 Tải bản Sao lưu (Full Backup .zip)
                      </a>
                      <label
                        className="btn btn-secondary"
                        style={{ cursor: restoringBackup ? 'not-allowed' : 'pointer', padding: '0.45rem 0.85rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                      >
                        {restoringBackup ? '⏳ Đang phục hồi...' : '📥 Khôi phục từ file .zip'}
                        <input
                          type="file"
                          accept=".zip"
                          style={{ display: 'none' }}
                          disabled={restoringBackup}
                          onChange={handleRestoreBackup}
                        />
                      </label>
                    </div>
                  </>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowProfileModal(false)} disabled={profileSubmitting}>Hủy</button>
                <button type="submit" className="btn btn-gradient" disabled={profileSubmitting}>
                  {profileSubmitting ? 'Đang lưu...' : 'Lưu thay đổi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
