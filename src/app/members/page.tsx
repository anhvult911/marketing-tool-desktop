'use client';

import React, { useState, useEffect } from 'react';

interface Member {
  id: number;
  email: string;
  fullName: string;
  role: string;
  joinedAt: string;
  isSuperAdmin?: boolean;
}

interface SystemUser {
  id: number;
  email: string;
  fullName: string;
  isSuperAdmin: boolean;
  createdAt: string;
  workspaces: Array<{ id: number; name: string; role: string }>;
}

interface Workspace {
  id: number;
  name: string;
  subscriptionPlan: string;
  createdAt: string;
  ownerName: string;
  ownerEmail: string;
  accountCount: number;
  proxyCount: number;
  memberCount: number;
  role?: string;
}

interface SocialAccount {
  id: number;
  platform: string;
  username: string;
  assigned: number;
}

function getInitials(name: string | null | undefined): string {
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

// User initials Avatar component with premium gradients
const UserAvatar = ({ name }: { name: string }) => {
  const initials = getInitials(name);
  
  // Deterministic gradient selection based on name
  const charCodeSum = name 
    ? name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) 
    : 0;
  
  const gradients = [
    'linear-gradient(135deg, #FF416C, #FF4B2B)', // Red-Orange
    'linear-gradient(135deg, #1fa2ff, #12d6df, #00ff87)', // Cyan-Green
    'linear-gradient(135deg, #8A2387, #E94057, #F27121)', // Purple-Orange
    'linear-gradient(135deg, #00c6ff, #0072ff)', // Blue glow
    'linear-gradient(135deg, #f9d423, #ff4e50)', // Sunfire
    'linear-gradient(135deg, #11998e, #38ef7d)', // Forest emerald
  ];
  const gradient = gradients[charCodeSum % gradients.length];

  return (
    <div className="user-avatar" style={{ background: gradient }}>
      {initials}
    </div>
  );
};

export default function MembersAndWorkspacesPage() {
  const [activeTab, setActiveTab] = useState<'members' | 'workspaces'>('members');
  const [sessionUser, setSessionUser] = useState<{ id: number; email: string; isSuperAdmin: boolean; role: string; activeWorkspaceId: number } | null>(null);
  
  // Loading & Alert states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Data states
  const [members, setMembers] = useState<Member[]>([]); 
  const [systemUsers, setSystemUsers] = useState<SystemUser[]>([]); 
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]); 
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState<string>('all');
  const [filterWorkspaceId, setFilterWorkspaceId] = useState<string>('all');

  // Modal display states
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [showAddWorkspaceModal, setShowAddWorkspaceModal] = useState(false);
  
  // Member Form states
  const [memberEmail, setMemberEmail] = useState('');
  const [memberFullName, setMemberFullName] = useState('');
  const [memberRole, setMemberRole] = useState('staff');
  const [submittingMember, setSubmittingMember] = useState(false);
  const [autoGeneratePassword, setAutoGeneratePassword] = useState(true);
  const [customPassword, setCustomPassword] = useState('');
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<number[]>([]);

  // Workspace Form states
  const [wsName, setWsName] = useState('');
  const [wsOwnerEmail, setWsOwnerEmail] = useState('');
  const [submittingWs, setSubmittingWs] = useState(false);

  const [loadingAccounts, setLoadingAccounts] = useState(false);

  // Workspace Assignment states (for System User - Super Admin only)
  const [selectedSystemUser, setSelectedSystemUser] = useState<SystemUser | null>(null);
  const [allWorkspacesList, setAllWorkspacesList] = useState<Array<{ id: number; name: string; joined: boolean; role: string }>>([]);
  const [savingUserWorkspaces, setSavingUserWorkspaces] = useState(false);

  // Edit member details states
  const [editingUser, setEditingUser] = useState<{ id: number; fullName: string; email: string; role?: string; isSuperAdmin?: boolean } | null>(null);
  const [submittingEditUser, setSubmittingEditUser] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [submittingReset, setSubmittingReset] = useState(false);
  const [generatedPasswordToShow, setGeneratedPasswordToShow] = useState('');

  // Edit workspace states
  const [editingWorkspace, setEditingWorkspace] = useState<{ id: number; name: string } | null>(null);
  const [submittingEditWs, setSubmittingEditWs] = useState(false);

  // Fetch current user session
  const fetchSession = async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setSessionUser(data.user);
        return data.user;
      }
    } catch (err) {
      console.error('Error fetching session:', err);
    }
    return null;
  };

  const loadData = async () => {
    setLoading(true);
    setError('');
    const user = await fetchSession();
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      // Always fetch workspaces and system users for Super Admin to ensure the selects/checkbox options are populated
      if (user.isSuperAdmin) {
        const wsRes = await fetch('/api/workspace?mode=all');
        if (wsRes.ok) {
          const wsData = await wsRes.json();
          setWorkspaces(wsData.workspaces || []);
        }

        const usersRes = await fetch('/api/workspace/members?mode=all');
        if (usersRes.ok) {
          const usersData = await usersRes.json();
          setSystemUsers(usersData.users || []);
        }
      }

      if (activeTab === 'members') {
        if (!user.isSuperAdmin) {
          const res = await fetch('/api/workspace/members');
          if (res.ok) {
            const data = await res.json();
            setMembers(data.members || []);
          } else {
            setError('Không thể tải danh sách thành viên Workspace.');
          }
        }
      } else {
        if (!user.isSuperAdmin) {
          const res = await fetch('/api/workspace?mode=single');
          if (res.ok) {
            const data = await res.json();
            setWorkspaces(data.workspace ? [data.workspace] : []);
          } else {
            setError('Không thể tải danh sách không gian làm việc.');
          }
        }
      }
    } catch (err) {
      setError('Lỗi kết nối máy chủ.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeTab]);

  useEffect(() => {
    if (showAddMemberModal && sessionUser) {
      setSelectedWorkspaceIds([sessionUser.activeWorkspaceId]);
      setAutoGeneratePassword(true);
      setCustomPassword('');
    }
  }, [showAddMemberModal, sessionUser]);

  // Auto-clear success/error toast notifications after 4 seconds
  useEffect(() => {
    if (success || error) {
      const timer = setTimeout(() => {
        setSuccess('');
        setError('');
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [success, error]);

  // Form submit handler: Invite member
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!memberRole) {
      setError('Vui lòng chọn vai trò.');
      return;
    }

    if (!autoGeneratePassword && (!customPassword || customPassword.trim().length < 6)) {
      setError('Mật khẩu tự chọn phải có ít nhất 6 ký tự.');
      return;
    }

    if (sessionUser?.isSuperAdmin && selectedWorkspaceIds.length === 0) {
      setError('Vui lòng chọn ít nhất 1 Không gian làm việc.');
      return;
    }

    setSubmittingMember(true);
    try {
      const res = await fetch('/api/workspace/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: memberEmail,
          role: memberRole,
          fullName: memberFullName,
          password: autoGeneratePassword ? undefined : customPassword.trim(),
          autoGeneratePassword,
          workspaceIds: sessionUser?.isSuperAdmin ? selectedWorkspaceIds : undefined
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setSuccess(data.message || 'Đã thêm thành viên thành công.');
        setMemberEmail('');
        setMemberFullName('');
        setMemberRole('staff');
        setCustomPassword('');
        setAutoGeneratePassword(true);
        setShowAddMemberModal(false);
        if (data.generatedPassword) {
          setGeneratedPasswordToShow(data.generatedPassword);
        }
        loadData();
      } else {
        setError(data.error || 'Lỗi thêm thành viên.');
      }
    } catch (err) {
      setError('Lỗi kết nối.');
    } finally {
      setSubmittingMember(false);
    }
  };

  // Update member role in active workspace
  const handleRoleChange = async (userId: number, newRole: string) => {
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/workspace/members', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role: newRole }),
      });

      const data = await res.json();
      if (res.ok) {
        setSuccess(data.message || 'Cập nhật vai trò thành công.');
        loadData();
      } else {
        setError(data.error || 'Không thể cập nhật vai trò.');
      }
    } catch (err) {
      setError('Lỗi kết nối.');
    }
  };

  // Remove member from active workspace or delete user globally if Super Admin
  const handleRemoveMember = async (userId: number, isGlobalDelete = false) => {
    const confirmMsg = isGlobalDelete 
      ? 'Bạn có chắc chắn muốn xóa vĩnh viễn người dùng này khỏi hệ thống? Thao tác này sẽ xóa mọi Workspace liên kết và giải phóng tài nguyên.'
      : 'Bạn có chắc chắn muốn xóa thành viên này khỏi Workspace? Tất cả gán quyền sử dụng tài nguyên sẽ bị xóa.';

    if (!confirm(confirmMsg)) {
      return;
    }

    setError('');
    setSuccess('');
    try {
      const url = isGlobalDelete 
        ? `/api/workspace/members?userId=${userId}&mode=global`
        : `/api/workspace/members?userId=${userId}`;

      const res = await fetch(url, {
        method: 'DELETE',
      });

      const data = await res.json();
      if (res.ok) {
        setSuccess(data.message || 'Đã xóa thành công.');
        loadData();
      } else {
        setError(data.error || 'Lỗi khi xóa.');
      }
    } catch (err) {
      setError('Lỗi kết nối.');
    }
  };

  // Workspace actions
  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!wsName) {
      setError('Vui lòng nhập tên Workspace.');
      return;
    }

    setSubmittingWs(true);
    try {
      const res = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: wsName, ownerEmail: wsOwnerEmail || undefined }),
      });

      const data = await res.json();
      if (res.ok) {
        setSuccess(data.message || 'Đã tạo Workspace thành công.');
        setWsName('');
        setWsOwnerEmail('');
        setShowAddWorkspaceModal(false);
        loadData();
      } else {
        setError(data.error || 'Không thể tạo Workspace.');
      }
    } catch (err) {
      setError('Lỗi kết nối.');
    } finally {
      setSubmittingWs(false);
    }
  };

  const handleUpdateWorkspaceName = async (id: number, currentName: string) => {
    const newName = prompt('Nhập tên Workspace mới:', currentName);
    if (!newName || !newName.trim() || newName.trim() === currentName) return;

    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/workspace', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: newName.trim() }),
      });

      const data = await res.json();
      if (res.ok) {
        setSuccess('Cập nhật tên Workspace thành công.');
        loadData();
      } else {
        setError(data.error || 'Không thể cập nhật tên.');
      }
    } catch (err) {
      setError('Lỗi kết nối.');
    }
  };



  const handleDeleteWorkspace = async (id: number, name: string) => {
    if (!confirm(`CẢNH BÁO CỰC KỲ QUAN TRỌNG: Bạn có chắc chắn muốn XÓA Workspace "${name}"?\nHành động này sẽ XÓA VĨNH VIỄN toàn bộ tài khoản social, proxy, và jobs liên quan của doanh nghiệp này.`)) {
      return;
    }

    setError('');
    setSuccess('');
    try {
      const res = await fetch(`/api/workspace?id=${id}`, {
        method: 'DELETE',
      });

      const data = await res.json();
      if (res.ok) {
        setSuccess(data.message || 'Đã xóa Workspace.');
        loadData();
      } else {
        setError(data.error || 'Không thể xóa Workspace.');
      }
    } catch (err) {
      setError('Lỗi kết nối.');
    }
  };


  const handleToggleUserWorkspace = async (workspaceId: number, currentJoined: boolean, userRole: string) => {
    if (!editingUser) return;
    
    setAllWorkspacesList(prev => 
      prev.map(ws => ws.id === workspaceId ? { ...ws, joined: !currentJoined } : ws)
    );

    try {
      const res = await fetch('/api/workspace/members/user-workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: editingUser.id,
          workspaceId,
          action: currentJoined ? 'leave' : 'join',
          role: userRole
        })
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Lỗi thực thi.');
        setAllWorkspacesList(prev => 
          prev.map(ws => ws.id === workspaceId ? { ...ws, joined: currentJoined } : ws)
        );
      } else {
        const reloadRes = await fetch('/api/workspace/members?mode=all');
        if (reloadRes.ok) {
          const data = await reloadRes.json();
          const users: SystemUser[] = data.users || [];
          setSystemUsers(users);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUserWorkspaceRoleChange = async (workspaceId: number, newRole: string) => {
    if (!editingUser) return;
    
    setAllWorkspacesList(prev => 
      prev.map(ws => ws.id === workspaceId ? { ...ws, role: newRole } : ws)
    );

    try {
      await fetch('/api/workspace/members/user-workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: editingUser.id,
          workspaceId,
          action: 'join',
          role: newRole
        })
      });
      const reloadRes = await fetch('/api/workspace/members?mode=all');
      if (reloadRes.ok) {
        const data = await reloadRes.json();
        setSystemUsers(data.users || []);
      }
    } catch (err) {
      console.error(err);
    }
  };


  const canEditRoleOf = (targetId: number, targetRole?: string, targetIsSuperAdmin?: boolean) => {
    if (!sessionUser) return false;
    if (sessionUser.isSuperAdmin) return true;
    if (targetIsSuperAdmin) return false;
    if (sessionUser.role === 'admin') {
      if (targetId === sessionUser.id) return true;
      return targetRole === 'staff' || targetRole === 'viewer';
    }
    return false;
  };

  const canEditProfileOf = (targetId: number, targetRole?: string, targetIsSuperAdmin?: boolean) => {
    if (!sessionUser) return false;
    if (sessionUser.isSuperAdmin) return true;
    if (targetIsSuperAdmin) return false;
    if (sessionUser.role === 'admin') {
      if (targetId === sessionUser.id) return true;
      return targetRole === 'staff' || targetRole === 'viewer';
    }
    return false;
  };

  const handleOpenEditUser = async (user: Member | SystemUser) => {
    setNewPassword('');
    let role = 'role' in user ? user.role : undefined;
    if (role === undefined && 'workspaces' in user && sessionUser?.activeWorkspaceId) {
      const activeWS = user.workspaces.find(w => w.id === sessionUser.activeWorkspaceId);
      role = activeWS ? activeWS.role : undefined;
    }
    setEditingUser({
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: role,
      isSuperAdmin: 'isSuperAdmin' in user ? !!user.isSuperAdmin : false,
    });

    if (sessionUser?.isSuperAdmin) {
      setLoadingAccounts(true);
      try {
        const res = await fetch('/api/workspace?mode=all');
        if (res.ok) {
          const data = await res.json();
          const allWS: Workspace[] = data.workspaces || [];
          
          const systemUserObj = systemUsers.find(u => u.id === user.id);
          const userWorkspaces = systemUserObj ? systemUserObj.workspaces : ('workspaces' in user ? user.workspaces : []);
          
          const mapped = allWS.map(ws => {
            const joinedWs = userWorkspaces.find(uWs => uWs.id === ws.id);
            return {
              id: ws.id,
              name: ws.name,
              joined: !!joinedWs,
              role: joinedWs ? joinedWs.role : 'staff'
            };
          });
          setAllWorkspacesList(mapped);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingAccounts(false);
      }
    }
  };

  const handleResetPassword = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    if (!newPassword || newPassword.trim().length < 6) {
      alert('Mật khẩu phải có ít nhất 6 ký tự.');
      return;
    }

    setSubmittingReset(true);
    try {
      const res = await fetch('/api/workspace/members', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: editingUser.id,
          action: 'resetPassword',
          password: newPassword.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok) {
        alert(data.message || 'Đặt lại mật khẩu thành công.');
        setNewPassword('');
      } else {
        alert(data.error || 'Đặt lại mật khẩu thất bại.');
      }
    } catch (err) {
      alert('Lỗi kết nối.');
    } finally {
      setSubmittingReset(false);
    }
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setError('');
    setSuccess('');
    setSubmittingEditUser(true);
    try {
      const res = await fetch('/api/workspace/members', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: editingUser.id,
          editProfile: true,
          fullName: editingUser.fullName,
          email: editingUser.email,
          role: editingUser.role,
          isSuperAdmin: editingUser.isSuperAdmin,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setSuccess(data.message || 'Cập nhật thông tin thành công.');
        setEditingUser(null);
        loadData();
      } else {
        setError(data.error || 'Cập nhật thất bại.');
      }
    } catch (err) {
      setError('Lỗi kết nối.');
    } finally {
      setSubmittingEditUser(false);
    }
  };

  const handleOpenEditWorkspace = (ws: Workspace) => {
    setEditingWorkspace({
      id: ws.id,
      name: ws.name,
    });
  };

  const handleEditWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWorkspace) return;
    setError('');
    setSuccess('');
    setSubmittingEditWs(true);
    try {
      const res = await fetch('/api/workspace', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingWorkspace.id,
          name: editingWorkspace.name,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setSuccess('Cập nhật Workspace thành công.');
        setEditingWorkspace(null);
        loadData();
      } else {
        setError(data.error || 'Cập nhật Workspace thất bại.');
      }
    } catch (err) {
      setError('Lỗi kết nối.');
    } finally {
      setSubmittingEditWs(false);
    }
  };

  // Filter members list based on query
  const filteredMembers = members.filter(m => {
    const matchesSearch = m.fullName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          m.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = filterRole === 'all' || m.role === filterRole;
    return matchesSearch && matchesRole;
  });

  const filteredSystemUsers = systemUsers.filter(u => {
    const matchesSearch = u.fullName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          u.email.toLowerCase().includes(searchQuery.toLowerCase());

    let matchesRole = true;
    if (filterRole !== 'all') {
      if (filterRole === 'super_admin') {
        matchesRole = u.isSuperAdmin;
      } else if (filterRole === 'none') {
        if (filterWorkspaceId === 'all') {
          matchesRole = u.workspaces.length === 0;
        } else {
          const targetWsId = parseInt(filterWorkspaceId);
          matchesRole = !u.workspaces.some(w => w.id === targetWsId);
        }
      } else {
        if (filterWorkspaceId === 'all') {
          matchesRole = u.workspaces.some(w => w.role === filterRole);
        } else {
          const targetWsId = parseInt(filterWorkspaceId);
          const wsObj = u.workspaces.find(w => w.id === targetWsId);
          matchesRole = wsObj ? wsObj.role === filterRole : false;
        }
      }
    }

    let matchesWorkspace = true;
    if (filterWorkspaceId !== 'all') {
      const targetWsId = parseInt(filterWorkspaceId);
      matchesWorkspace = u.workspaces.some(w => w.id === targetWsId);
    }

    return matchesSearch && matchesRole && matchesWorkspace;
  });

  const filteredWorkspaces = workspaces.filter(w => 
    w.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="premium-admin-container">
      <style dangerouslySetInnerHTML={{ __html: `
        /* Premium UI Redesign using Glassmorphism & Soft Glows */
        .premium-admin-container {
          padding: 2rem;
          max-width: 1280px;
          margin: 0 auto;
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 2rem;
          position: relative;
        }

        /* Ambient Glow Background Effect */
        .premium-admin-container::before {
          content: '';
          position: absolute;
          top: -10%;
          right: 5%;
          width: 350px;
          height: 350px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(47, 129, 247, 0.15) 0%, transparent 70%);
          z-index: -1;
          pointer-events: none;
        }

        .premium-admin-container::after {
          content: '';
          position: absolute;
          bottom: 10%;
          left: 5%;
          width: 300px;
          height: 300px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(138, 35, 135, 0.1) 0%, transparent 70%);
          z-index: -1;
          pointer-events: none;
        }

        /* Title Area */
        .page-header-desc {
          font-size: 0.95rem;
          color: var(--text-secondary);
          margin-top: 0.35rem;
          max-width: 800px;
          line-height: 1.5;
        }

        /* Pill Tab Switcher Styling */
        .premium-tabs {
          display: inline-flex;
          background: var(--bg-surface);
          border: 1px solid var(--border-color);
          padding: 6px;
          border-radius: 12px;
          gap: 4px;
          align-self: flex-start;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }

        .premium-tab-btn {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          padding: 0.6rem 1.5rem;
          font-size: 0.9rem;
          font-weight: 600;
          cursor: pointer;
          border-radius: 8px;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .premium-tab-btn:hover {
          color: var(--text-primary);
        }

        .premium-tab-btn.active {
          color: #ffffff;
          background: linear-gradient(135deg, var(--color-primary) 0%, #58a6ff 100%);
          box-shadow: 0 4px 14px rgba(47, 129, 247, 0.3);
        }

        /* Premium Glassmorphic Table Container */
        .glass-table-card {
          background: var(--bg-card);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid var(--border-subtle);
          border-radius: 16px;
          box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.25);
          overflow: hidden;
        }

        /* Toolbar controls layout */
        .glass-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1.5rem;
          flex-wrap: wrap;
          padding: 1.5rem;
          border-bottom: 1px solid var(--border-subtle);
        }

        .search-wrapper {
          position: relative;
          display: flex;
          align-items: center;
          width: 100%;
          max-width: 320px;
        }

        .search-icon {
          position: absolute;
          left: 12px;
          color: var(--text-secondary);
          pointer-events: none;
          font-size: 0.95rem;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .premium-search-input {
          width: 100%;
          background: rgba(13, 17, 23, 0.6) !important;
          border: 1px solid var(--border-color) !important;
          border-radius: 8px !important;
          padding: 0.65rem 0.85rem 0.65rem 2.2rem !important;
          color: var(--text-primary) !important;
          font-size: 0.9rem !important;
          transition: all 0.2s ease !important;
          box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
        }

        .premium-search-input:focus {
          border-color: var(--color-primary) !important;
          box-shadow: 0 0 0 3px rgba(47, 129, 247, 0.15) !important;
          outline: none !important;
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

        /* User Avatars */
        .user-avatar-cell {
          display: flex;
          align-items: center;
          gap: 0.85rem;
        }

        .user-avatar {
          width: 38px;
          height: 38px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
          font-weight: 700;
          font-size: 0.85rem;
          box-shadow: 0 2px 8px rgba(0,0,0,0.25);
          flex-shrink: 0;
          text-shadow: 0 1px 2px rgba(0,0,0,0.3);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        /* Pill Badges */
        .pill-badge {
          display: inline-flex;
          align-items: center;
          padding: 0.3rem 0.75rem;
          font-size: 0.75rem;
          font-weight: 600;
          border-radius: 30px;
          border: 1px solid transparent;
          transition: all 0.2s;
        }

        .pill-badge-super {
          background: rgba(248, 81, 73, 0.12);
          color: #f85149;
          border-color: rgba(248, 81, 73, 0.3);
          box-shadow: 0 2px 6px rgba(248, 81, 73, 0.1);
        }

        .pill-badge-normal {
          background: rgba(139, 148, 158, 0.12);
          color: var(--text-secondary);
          border-color: var(--border-color);
        }

        .ws-badge-pill {
          display: inline-flex;
          align-items: center;
          padding: 2px 10px;
          font-size: 0.75rem;
          font-weight: 600;
          border-radius: 6px;
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--border-color);
          color: var(--text-secondary);
          transition: all 0.2s;
        }

        .ws-badge-pill.admin {
          background: rgba(47, 129, 247, 0.08);
          color: var(--color-primary-hover);
          border-color: rgba(47, 129, 247, 0.25);
        }

        .ws-badge-pill.staff {
          background: rgba(63, 185, 80, 0.08);
          color: var(--color-success);
          border-color: rgba(63, 185, 80, 0.25);
        }

        .ws-badge-pill.viewer {
          background: rgba(139, 148, 158, 0.08);
          color: var(--text-secondary);
          border-color: rgba(139, 148, 158, 0.25);
        }

        .ws-badge-pill.none {
          background: rgba(248, 81, 73, 0.05);
          color: rgba(248, 81, 73, 0.7);
          border-color: rgba(248, 81, 73, 0.15);
        }

        .ws-badge-pill.pro {
          background: rgba(138, 35, 135, 0.1);
          color: #e94057;
          border-color: rgba(138, 35, 135, 0.3);
        }

        .ws-badge-pill.enterprise {
          background: rgba(210, 153, 34, 0.1);
          color: var(--color-warning);
          border-color: rgba(210, 153, 34, 0.3);
        }

        .ws-badge-pill.basic {
          background: rgba(47, 129, 247, 0.1);
          color: var(--color-primary-hover);
          border-color: rgba(47, 129, 247, 0.3);
        }

        /* Action Buttons with icon layouts */
        .btn-icon-outline {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: rgba(255, 255, 255, 0.7);
          padding: 0.35rem 0.75rem;
          font-size: 0.8rem;
          font-weight: 500;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          height: 30px;
        }

        .btn-icon-outline:hover {
          color: #58a6ff;
          background: rgba(47, 129, 247, 0.1);
          border-color: var(--color-primary);
          box-shadow: 0 0 10px rgba(47, 129, 247, 0.15);
        }

        .btn-icon-danger {
          background: rgba(248, 81, 73, 0.02);
          border: 1px solid rgba(248, 81, 73, 0.15);
          color: rgba(248, 81, 73, 0.7);
          padding: 0.35rem 0.75rem;
          font-size: 0.8rem;
          font-weight: 500;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          height: 30px;
        }

        .btn-icon-danger:hover {
          background: rgba(248, 81, 73, 0.12);
          border-color: #ff7b72;
          color: #ff7b72;
          box-shadow: 0 0 10px rgba(248, 81, 73, 0.2);
        }

        .btn-icon-assign {
          background: rgba(56, 239, 125, 0.02);
          border: 1px solid rgba(56, 239, 125, 0.15);
          color: rgba(56, 239, 125, 0.7);
          padding: 0.35rem 0.75rem;
          font-size: 0.8rem;
          font-weight: 500;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          height: 30px;
        }

        .btn-icon-assign:hover {
          background: rgba(56, 239, 125, 0.12);
          border-color: #57f287;
          color: #57f287;
          box-shadow: 0 0 10px rgba(56, 239, 125, 0.2);
        }

        /* Dropdowns & Selects styling inside table */
        .glass-select {
          background: rgba(13, 17, 23, 0.6);
          border: 1px solid var(--border-color);
          color: var(--text-primary);
          border-radius: 6px;
          padding: 0.35rem 0.5rem;
          font-size: 0.85rem;
          font-family: inherit;
          cursor: pointer;
          outline: none;
          transition: border-color 0.2s;
        }

        .glass-select:focus {
          border-color: var(--color-primary);
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
          box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6), 0 0 40px rgba(47, 129, 247, 0.03);
          overflow: hidden;
          animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
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

        .assign-list {
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
          max-height: 300px;
          overflow-y: auto;
          padding: 0.25rem;
        }

        .assign-item {
          display: flex;
          align-items: center;
          padding: 0.75rem 1rem;
          background: rgba(13, 17, 23, 0.4);
          border: 1px solid var(--border-color);
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s ease;
          gap: 0.75rem;
        }

        .assign-item:hover {
          border-color: rgba(47, 129, 247, 0.4);
          background: rgba(47, 129, 247, 0.03);
        }

        .assign-item.selected {
          border-color: var(--color-primary);
          background: rgba(47, 129, 247, 0.08);
        }

        .assign-checkbox {
          width: 18px;
          height: 18px;
          accent-color: var(--color-primary);
          cursor: pointer;
        }

        .assign-details {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }

        .assign-platform {
          font-size: 0.7rem;
          font-weight: 700;
          text-transform: uppercase;
          color: var(--text-secondary);
          letter-spacing: 0.02em;
        }

        .assign-item.selected .assign-platform {
          color: var(--color-primary-hover);
        }

        .assign-username {
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--text-primary);
        }

        /* Workspace Grid & Card Styles */
        .workspace-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
          gap: 1.5rem;
          padding: 1.5rem;
        }

        .workspace-card {
          background: var(--bg-card);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          padding: 1.25rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
          position: relative;
          overflow: hidden;
        }

        .workspace-card:hover {
          transform: translateY(-4px);
          border-color: rgba(47, 129, 247, 0.4);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3), 0 0 20px rgba(47, 129, 247, 0.05);
        }

        .workspace-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 4px;
          height: 100%;
          background: var(--border-color);
          transition: background 0.3s;
        }

        .workspace-card:hover::before {
          background: var(--color-primary);
        }

        .ws-card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 1rem;
        }

        .ws-card-title-box {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .ws-card-icon {
          font-size: 1.5rem;
        }

        .ws-card-name {
          font-weight: 700;
          font-size: 1.05rem;
          color: var(--text-primary);
        }

        .ws-card-id {
          font-size: 0.7rem;
          color: var(--text-muted);
        }

        .ws-card-stats {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 0.5rem;
          background: rgba(13, 17, 23, 0.4);
          border-radius: 10px;
          padding: 0.75rem 0.5rem;
          border: 1px solid rgba(48, 54, 61, 0.3);
        }

        .ws-stat-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 0.25rem;
        }

        .ws-stat-icon {
          font-size: 1rem;
        }

        .ws-stat-content {
          display: flex;
          flex-direction: column;
        }

        .ws-stat-label {
          font-size: 0.6rem;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.02em;
        }

        .ws-stat-val {
          font-weight: 700;
          font-size: 0.95rem;
          color: var(--text-primary);
        }

        .ws-card-owner {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          border-top: 1px dashed var(--border-subtle);
          padding-top: 0.75rem;
        }

        .ws-owner-info {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }

        .ws-owner-label {
          font-size: 0.65rem;
          color: var(--text-muted);
          text-transform: uppercase;
          font-weight: 600;
        }

        .ws-owner-name {
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--text-primary);
        }

        .ws-owner-email {
          font-size: 0.75rem;
          color: var(--text-secondary);
        }

        .ws-card-actions {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          border-top: 1px solid var(--border-subtle);
          padding-top: 0.75rem;
        }

        .ws-action-plan-select {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .ws-action-buttons {
          display: flex;
          justify-content: flex-end;
          gap: 0.5rem;
          width: 100%;
        }

        /* Toast floating notification style */
        .alert-error, .alert-success {
          position: fixed;
          top: 24px;
          right: 24px;
          z-index: 10000;
          padding: 1rem 1.5rem;
          border-radius: 10px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-weight: 500;
          font-size: 0.9rem;
          animation: slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          backdrop-filter: blur(10px);
          max-width: 400px;
        }

        .alert-error {
          background: rgba(248, 81, 73, 0.15);
          border: 1px solid rgba(248, 81, 73, 0.3);
          border-left: 4px solid var(--color-danger);
          color: #ff7b72;
        }

        .alert-success {
          background: rgba(63, 185, 80, 0.15);
          border: 1px solid rgba(63, 185, 80, 0.3);
          border-left: 4px solid var(--color-success);
          color: #56d364;
        }

        /* Animations */
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        @keyframes slideInRight {
          from { transform: translateX(100px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      ` }} />

      <div className="page-header">
        <h2 style={{ fontSize: '1.8rem', fontWeight: 800, background: 'linear-gradient(90deg, #ffffff, #8b949e)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Thiết lập Hệ thống & Tổ chức
        </h2>
        <p className="page-header-desc">
          {sessionUser?.isSuperAdmin 
            ? 'Quản trị viên hệ thống cấp cao: Quản lý đăng ký người dùng, chuyển giao tài nguyên không gian làm việc và cấu hình phân gói Platform.' 
            : 'Quản trị nhóm làm việc: Quản trị các thành viên trong không gian và cấp phát quyền sử dụng các tài khoản mạng xã hội X, Zalo...'}
        </p>
      </div>

      {error && <div className="alert-error">⚠️ {error}</div>}
      {success && <div className="alert-success">✅ {success}</div>}

      {/* TABS SWITCHER */}
      {sessionUser?.isSuperAdmin && (
        <div className="premium-tabs">
          <button 
            className={`premium-tab-btn ${activeTab === 'members' ? 'active' : ''}`}
            onClick={() => setActiveTab('members')}
          >
            <span>👥</span> Tài khoản người dùng
          </button>
          <button 
            className={`premium-tab-btn ${activeTab === 'workspaces' ? 'active' : ''}`}
            onClick={() => setActiveTab('workspaces')}
          >
            <span>🏢</span> Không gian làm việc
          </button>
        </div>
      )}

      {/* MAIN CONTAINER */}
      <div className="glass-table-card">
        {/* TOOLBAR */}
        <div className="glass-toolbar" style={{ display: 'flex', gap: '1rem', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', flex: 1, maxWidth: '800px' }}>
            <div className="search-wrapper" style={{ flex: 2, minWidth: '220px' }}>
              <span className="search-icon">🔍</span>
              <input
                type="text"
                className="search-input premium-search-input"
                placeholder={activeTab === 'members' ? 'Tìm kiếm theo tên hoặc tên đăng nhập...' : 'Tìm kiếm không gian làm việc...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {activeTab === 'members' && (
              <>
                {/* Role Filter */}
                <select
                  className="glass-select"
                  value={filterRole}
                  onChange={(e) => setFilterRole(e.target.value)}
                  style={{ flex: 1, minWidth: '160px', height: '42px', padding: '0 1rem', fontSize: '0.85rem' }}
                >
                  <option value="all">Tất cả vai trò</option>
                  {sessionUser?.isSuperAdmin && <option value="super_admin">👑 Super Admin</option>}
                  <option value="admin">Workspace Admin</option>
                  <option value="staff">Staff</option>
                  <option value="viewer">Viewer</option>
                  {sessionUser?.isSuperAdmin && <option value="none">Chưa tham gia Workspace</option>}
                </select>

                {/* Workspace Filter (Super Admin only) */}
                {sessionUser?.isSuperAdmin && (
                  <select
                    className="glass-select"
                    value={filterWorkspaceId}
                    onChange={(e) => setFilterWorkspaceId(e.target.value)}
                    style={{ flex: 1, minWidth: '180px', height: '42px', padding: '0 1rem', fontSize: '0.85rem' }}
                  >
                    <option value="all">Tất cả Workspace</option>
                    {workspaces.map(ws => (
                      <option key={ws.id} value={ws.id.toString()}>{ws.name}</option>
                    ))}
                  </select>
                )}
              </>
            )}
          </div>

          {activeTab === 'members' ? (
            <button className="btn btn-gradient" onClick={() => setShowAddMemberModal(true)}>
              <span>➕</span> Thêm thành viên
            </button>
          ) : (
            sessionUser?.isSuperAdmin && (
              <button className="btn btn-gradient" onClick={() => setShowAddWorkspaceModal(true)}>
                <span>🏢</span> Tạo Workspace mới
              </button>
            )
          )}
        </div>

        {/* LOADING STATE */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-secondary)' }}>
            <div style={{ display: 'inline-block', width: '24px', height: '24px', border: '3px solid rgba(255,255,255,0.1)', borderTop: '3px solid var(--color-primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginRight: '12px' }} />
            <span style={{ fontSize: '0.95rem', fontWeight: 500 }}>Đang đồng bộ dữ liệu...</span>
          </div>
        ) : (
          <div className="table-container" style={{ border: 'none', background: 'transparent' }}>
            {/* TAB 1: MEMBERS */}
            {activeTab === 'members' && (
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: '35%', paddingLeft: '1.5rem' }}>Người dùng</th>
                    {sessionUser?.isSuperAdmin ? (
                      <>
                        <th style={{ width: '20%' }}>Vai trò</th>
                        <th style={{ width: '30%' }}>Workspace liên kết</th>
                      </>
                    ) : (
                      <>
                        <th style={{ width: '25%' }}>Vai trò Workspace</th>
                        <th style={{ width: '25%' }}>Ngày tham gia</th>
                      </>
                    )}
                    <th style={{ width: '15%', textAlign: 'right', paddingRight: '1.5rem' }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Workspace Admin / Staff Listing */}
                  {!sessionUser?.isSuperAdmin && filteredMembers.map((member) => (
                    <tr key={member.id}>
                      <td style={{ paddingLeft: '1.5rem' }}>
                        <div className="user-avatar-cell">
                          <UserAvatar name={member.fullName} />
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{member.fullName}</span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{member.email}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        {member.isSuperAdmin ? (
                          <span className="pill-badge pill-badge-super">
                            👑 Super Admin
                          </span>
                        ) : (
                          <span style={{ textTransform: 'capitalize' }} className={`ws-badge-pill ${member.role}`}>
                            {member.role === 'admin' ? 'Workspace Admin' : member.role === 'staff' ? 'Staff' : member.role === 'viewer' ? 'Viewer' : member.role}
                          </span>
                        )}
                      </td>
                      <td>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                          {member.joinedAt ? member.joinedAt.substring(0, 10) : '-'}
                        </span>
                      </td>
                      <td style={{ paddingRight: '1.5rem', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                          <button className="btn-icon-outline" onClick={() => handleOpenEditUser(member)} title="Sửa thông tin">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                            Sửa
                          </button>
                          <button className="btn-icon-danger" onClick={() => handleRemoveMember(member.id)} title="Xóa khỏi Workspace">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                            Xóa
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {/* Super Admin Listing */}
                  {sessionUser?.isSuperAdmin && filteredSystemUsers.map((user) => (
                    <tr key={user.id}>
                      <td style={{ paddingLeft: '1.5rem' }}>
                        <div className="user-avatar-cell">
                          <UserAvatar name={user.fullName} />
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{user.fullName}</span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{user.email}</span>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                              Đăng ký: {user.createdAt ? user.createdAt.substring(0, 10) : '-'}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>
                        {user.isSuperAdmin ? (
                          <span className="pill-badge pill-badge-super">
                            👑 Super Admin
                          </span>
                        ) : (() => {
                          const targetWsId = filterWorkspaceId === 'all' 
                            ? (user.workspaces.length > 0 ? user.workspaces[0].id : null) 
                            : parseInt(filterWorkspaceId);
                          const wsMember = targetWsId ? user.workspaces.find(w => w.id === targetWsId) : undefined;
                          const role = wsMember ? wsMember.role : 'none';
                          const roleLabel = role === 'admin' ? 'Workspace Admin' : role === 'staff' ? 'Staff' : role === 'viewer' ? 'Viewer' : 'Chưa tham gia';
                          return (
                            <span className={`ws-badge-pill ${role}`} style={{ textTransform: 'capitalize' }}>
                              👤 {roleLabel}
                            </span>
                          );
                        })()}
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                          {user.workspaces.map((ws) => (
                            <span key={ws.id} className={`ws-badge-pill ${ws.role}`} title={`Workspace ID: ${ws.id}`}>
                              {ws.name} ({ws.role === 'admin' ? 'Admin' : ws.role === 'staff' ? 'Staff' : 'Viewer'})
                            </span>
                          ))}
                        </div>
                      </td>
                      <td style={{ paddingRight: '1.5rem', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                          <button className="btn-icon-outline" onClick={() => handleOpenEditUser(user)} title="Sửa thông tin người dùng">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                            Sửa
                          </button>
                          <button className="btn-icon-danger" onClick={() => handleRemoveMember(user.id, true)} title="Xóa người dùng vĩnh viễn">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                            Xóa
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {(sessionUser?.isSuperAdmin ? filteredSystemUsers.length : filteredMembers.length) === 0 && (
                    <tr>
                      <td colSpan={sessionUser?.isSuperAdmin ? 4 : 4} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                        Không có kết quả người dùng phù hợp.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}

            {/* TAB 2: WORKSPACES - Cards Layout */}
            {activeTab === 'workspaces' && sessionUser?.isSuperAdmin && (
              <div className="workspace-grid">
                {filteredWorkspaces.map((ws) => (
                  <div key={ws.id} className="workspace-card">
                    <div className="ws-card-header">
                      <div className="ws-card-title-box">
                        <span className="ws-card-icon">🏢</span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span className="ws-card-name">{ws.name}</span>
                          <span className="ws-card-id">Workspace ID: {ws.id}</span>
                        </div>
                      </div>
                    </div>

                    <div className="ws-card-stats">
                      <div className="ws-stat-item">
                        <span className="ws-stat-icon">🔑</span>
                        <div className="ws-stat-content">
                          <span className="ws-stat-label">Tài khoản</span>
                          <span className="ws-stat-val">{ws.accountCount}</span>
                        </div>
                      </div>
                      <div className="ws-stat-item">
                        <span className="ws-stat-icon">🌐</span>
                        <div className="ws-stat-content">
                          <span className="ws-stat-label">Proxies</span>
                          <span className="ws-stat-val">{ws.proxyCount}</span>
                        </div>
                      </div>
                      <div className="ws-stat-item">
                        <span className="ws-stat-icon">👥</span>
                        <div className="ws-stat-content">
                          <span className="ws-stat-label">Thành viên</span>
                          <span className="ws-stat-val">{ws.memberCount}</span>
                        </div>
                      </div>
                    </div>

                    <div className="ws-card-owner">
                      <UserAvatar name={ws.ownerName || 'Hệ thống'} />
                      <div className="ws-owner-info">
                        <span className="ws-owner-label">Chủ sở hữu</span>
                        <span className="ws-owner-name">{ws.ownerName || 'Hệ thống'}</span>
                        {ws.ownerEmail && <span className="ws-owner-email">{ws.ownerEmail}</span>}
                      </div>
                    </div>

                    <div className="ws-card-actions">
                      <div style={{ flex: 1 }} />
                      <div className="ws-action-buttons">
                        <button className="btn-icon-outline" onClick={() => handleOpenEditWorkspace(ws)} title="Sửa tên">
                          ✏️ Sửa
                        </button>
                        {sessionUser?.isSuperAdmin && ws.id !== 1 && (
                          <button className="btn-icon-danger" onClick={() => handleDeleteWorkspace(ws.id, ws.name)} title="Xóa Workspace">
                            🗑️ Xóa
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {filteredWorkspaces.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-secondary)', gridColumn: '1 / -1' }}>
                    Không tìm thấy Workspace phù hợp.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: ADD MEMBER */}
      {showAddMemberModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title">👥 Thêm thành viên mới</h3>
              <button className="modal-close-btn" onClick={() => setShowAddMemberModal(false)}>×</button>
            </div>
            <form onSubmit={handleAddMember}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Họ tên thành viên (Tùy chọn)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Nguyễn Văn A"
                    value={memberFullName}
                    onChange={(e) => setMemberFullName(e.target.value)}
                    disabled={submittingMember}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Tên đăng nhập (Username) - Tùy chọn</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="vutran, anhvu... (để trống nếu tự tạo)"
                    value={memberEmail}
                    onChange={(e) => setMemberEmail(e.target.value)}
                    disabled={submittingMember}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Vai trò trong Workspace</label>
                  <select
                    className="form-input glass-select"
                    value={memberRole}
                    onChange={(e) => setMemberRole(e.target.value)}
                    disabled={submittingMember}
                    style={{ height: '42px' }}
                  >
                    <option value="staff">Staff (Vận hành chiến dịch)</option>
                    <option value="viewer">Viewer (Chỉ xem báo cáo)</option>
                    <option value="admin">Admin (Toàn quyền quản trị)</option>
                  </select>
                </div>

                {/* Password Configuration */}
                <div className="form-group" style={{ marginTop: '15px' }}>
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 500 }}>
                    <input
                      type="checkbox"
                      checked={autoGeneratePassword}
                      onChange={(e) => setAutoGeneratePassword(e.target.checked)}
                      disabled={submittingMember}
                      style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                    />
                    Tự động tạo mật khẩu ngẫu nhiên
                  </label>
                </div>

                {!autoGeneratePassword && (
                  <div className="form-group animate-slide-down">
                    <label className="form-label">Mật khẩu tự chọn (Tối thiểu 6 ký tự)</label>
                    <input
                      type="password"
                      className="form-input"
                      placeholder="Nhập mật khẩu cho thành viên..."
                      value={customPassword}
                      onChange={(e) => setCustomPassword(e.target.value)}
                      disabled={submittingMember}
                      required
                    />
                  </div>
                )}

                {/* Workspace Assignment (1 or more) - for Super Admin only */}
                {sessionUser?.isSuperAdmin && (
                  <div className="form-group" style={{ marginTop: '20px' }}>
                    <label className="form-label" style={{ marginBottom: '8px' }}>Chọn Không gian làm việc liên kết (Ít nhất 1)</label>
                    <div style={{
                      maxHeight: '150px',
                      overflowY: 'auto',
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      padding: '10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px'
                    }} className="glass-scrollbar">
                      {workspaces.map((ws) => (
                        <label key={ws.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px' }}>
                          <input
                            type="checkbox"
                            checked={selectedWorkspaceIds.includes(ws.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedWorkspaceIds([...selectedWorkspaceIds, ws.id]);
                              } else {
                                setSelectedWorkspaceIds(selectedWorkspaceIds.filter(id => id !== ws.id));
                              }
                            }}
                            disabled={submittingMember}
                            style={{ width: '15px', height: '15px', cursor: 'pointer' }}
                          />
                          <span>{ws.name}</span>
                          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
                            ({ws.subscriptionPlan})
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddMemberModal(false)} disabled={submittingMember}>❌ Hủy</button>
                <button type="submit" className="btn btn-gradient" disabled={submittingMember}>
                  {submittingMember ? '⏳ Đang mời...' : '✉️ Mời thành viên'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ADD WORKSPACE (Super Admin Only) */}
      {showAddWorkspaceModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title">🏢 Tạo Workspace mới</h3>
              <button className="modal-close-btn" onClick={() => setShowAddWorkspaceModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreateWorkspace}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Tên không gian làm việc</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Ví dụ: Công ty XYZ Marketing"
                    value={wsName}
                    onChange={(e) => setWsName(e.target.value)}
                    disabled={submittingWs}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Chủ sở hữu không gian làm việc</label>
                  <select
                    className="form-input glass-select"
                    value={wsOwnerEmail}
                    onChange={(e) => setWsOwnerEmail(e.target.value)}
                    disabled={submittingWs}
                    style={{ height: '42px' }}
                  >
                    <option value="">-- Chọn Chủ sở hữu (Mặc định: Bản thân tôi) --</option>
                    {systemUsers.map((u) => (
                      <option key={u.id} value={u.email}>
                        {u.fullName || u.email} ({u.email})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddWorkspaceModal(false)} disabled={submittingWs}>❌ Hủy</button>
                <button type="submit" className="btn btn-gradient" disabled={submittingWs}>
                  {submittingWs ? '⏳ Đang tạo...' : '🏢 Tạo Workspace'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}





      {/* MODAL 5: EDIT USER / MEMBER */}
      {editingUser && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title">✏️ Chỉnh sửa thông tin người dùng</h3>
              <button className="modal-close-btn" onClick={() => setEditingUser(null)}>×</button>
            </div>
            <form onSubmit={handleEditUser}>
              <div className="modal-body">
                {!canEditProfileOf(editingUser.id, editingUser.role, editingUser.isSuperAdmin) && !canEditRoleOf(editingUser.id, editingUser.role, editingUser.isSuperAdmin) && (
                  <div style={{
                    background: 'rgba(217, 83, 79, 0.1)',
                    color: '#ff6b6b',
                    padding: '10px 12px',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    marginBottom: '15px',
                    border: '1px solid rgba(217, 83, 79, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <span>⚠️ Bạn không có quyền chỉnh sửa thông tin hoặc vai trò của thành viên này.</span>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">Họ tên người dùng</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Nguyễn Văn A"
                    value={editingUser.fullName}
                    onChange={(e) => setEditingUser({ ...editingUser, fullName: e.target.value })}
                    disabled={submittingEditUser || !canEditProfileOf(editingUser.id, editingUser.role, editingUser.isSuperAdmin)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Tên đăng nhập (Username)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="vutran, anhvu..."
                    value={editingUser.email}
                    onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                    disabled={submittingEditUser || !canEditProfileOf(editingUser.id, editingUser.role, editingUser.isSuperAdmin)}
                    required
                  />
                </div>
                
                {editingUser.role !== undefined && !sessionUser?.isSuperAdmin && (
                  <div className="form-group">
                    <label className="form-label">Vai trò trong Workspace</label>
                    <select
                      className="form-input glass-select"
                      value={editingUser.role}
                      onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value })}
                      disabled={submittingEditUser || !canEditRoleOf(editingUser.id, editingUser.role, editingUser.isSuperAdmin)}
                      style={{ height: '42px' }}
                    >
                      <option value="staff">Staff (Vận hành chiến dịch)</option>
                      <option value="viewer">Viewer (Chỉ xem báo cáo)</option>
                      <option value="admin">Admin (Toàn quyền quản trị)</option>
                    </select>
                  </div>
                )}

                {sessionUser?.isSuperAdmin && (
                  <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '15px' }}>
                    <input
                      type="checkbox"
                      id="isSuperAdminCheckbox"
                      checked={!!editingUser.isSuperAdmin}
                      onChange={(e) => setEditingUser({ ...editingUser, isSuperAdmin: e.target.checked })}
                      disabled={submittingEditUser || editingUser.id === sessionUser.id}
                      style={{ cursor: editingUser.id === sessionUser.id ? 'not-allowed' : 'pointer', width: '18px', height: '18px' }}
                    />
                    <label htmlFor="isSuperAdminCheckbox" className="form-label" style={{ margin: 0, cursor: editingUser.id === sessionUser.id ? 'not-allowed' : 'pointer', fontSize: '0.9rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      👑 Cấp quyền quản trị tối cao (Super Admin)
                    </label>
                  </div>
                )}

                {sessionUser?.isSuperAdmin && (
                  <div style={{ marginTop: '20px' }}>
                    <label className="form-label" style={{ marginBottom: '8px', display: 'block' }}>🏢 Không gian làm việc được giao</label>
                    {loadingAccounts ? (
                      <div style={{ textAlign: 'center', padding: '1rem' }}>
                        <div style={{ display: 'inline-block', width: '20px', height: '20px', border: '2px solid rgba(255,255,255,0.1)', borderTop: '2px solid var(--color-primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                      </div>
                    ) : allWorkspacesList.length === 0 ? (
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Chưa cấu hình Workspace nào.</div>
                    ) : (
                      <div className="assign-list" style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '8px', padding: '5px' }}>
                        {allWorkspacesList.map((ws) => (
                          <div 
                            key={ws.id} 
                            className={`assign-item ${ws.joined ? 'selected' : ''}`}
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderBottom: '1px solid rgba(255, 255, 255, 0.03)' }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', flex: 1 }} onClick={() => handleToggleUserWorkspace(ws.id, ws.joined, ws.role)}>
                              <input 
                                type="checkbox" 
                                className="assign-checkbox"
                                checked={ws.joined}
                                onChange={() => {}} 
                              />
                              <div className="assign-details">
                                <span className="assign-username" style={{ fontSize: '0.85rem', color: '#fff' }}>{ws.name}</span>
                              </div>
                            </div>
                            
                            {ws.joined && (
                              <select
                                className="glass-select"
                                value={ws.role}
                                onChange={(e) => handleUserWorkspaceRoleChange(ws.id, e.target.value)}
                                style={{ padding: '2px 6px', fontSize: '0.75rem', height: '26px', minWidth: '80px' }}
                              >
                                <option value="admin">Admin</option>
                                <option value="staff">Staff</option>
                                <option value="viewer">Viewer</option>
                              </select>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {!!editingUser && canEditProfileOf(editingUser.id, editingUser.role, editingUser.isSuperAdmin) && (
                  <>
                    <hr style={{ border: 'none', borderTop: '1px solid rgba(255, 255, 255, 0.1)', margin: '20px 0' }} />
                    <h4 style={{ fontSize: '15px', color: '#fff', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      🔑 Đặt lại mật khẩu nhân viên
                    </h4>
                    <div className="form-group" style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
                      <div style={{ flex: 1 }}>
                        <label className="form-label" style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Mật khẩu mới (tối thiểu 6 ký tự)</label>
                        <input
                          type="password"
                          className="form-input"
                          placeholder="Nhập mật khẩu mới..."
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          disabled={submittingReset}
                        />
                      </div>
                      <button
                        type="button"
                        className="btn btn-gradient"
                        style={{ height: '40px', padding: '0 15px', whiteSpace: 'nowrap' }}
                        disabled={submittingReset || !newPassword}
                        onClick={handleResetPassword}
                      >
                        {submittingReset ? '⏳ Đang lưu...' : '🔑 Cập nhật mật khẩu'}
                      </button>
                    </div>
                  </>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setEditingUser(null)} disabled={submittingEditUser}>❌ Hủy</button>
                <button
                  type="submit"
                  className="btn btn-gradient"
                  disabled={submittingEditUser || (!canEditProfileOf(editingUser.id, editingUser.role, editingUser.isSuperAdmin) && !canEditRoleOf(editingUser.id, editingUser.role, editingUser.isSuperAdmin))}
                >
                  {submittingEditUser ? '⏳ Đang lưu...' : '💾 Lưu thay đổi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 6: EDIT WORKSPACE */}
      {editingWorkspace && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title">✏️ Chỉnh sửa Không gian làm việc</h3>
              <button className="modal-close-btn" onClick={() => setEditingWorkspace(null)}>×</button>
            </div>
            <form onSubmit={handleEditWorkspace}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Tên không gian làm việc</label>
                  <input
                    type="text"
                    className="form-input"
                    value={editingWorkspace.name}
                    onChange={(e) => setEditingWorkspace({ ...editingWorkspace, name: e.target.value })}
                    disabled={submittingEditWs}
                    required
                  />
                </div>

              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setEditingWorkspace(null)} disabled={submittingEditWs}>❌ Hủy</button>
                <button type="submit" className="btn btn-gradient" disabled={submittingEditWs}>
                  {submittingEditWs ? '⏳ Đang lưu...' : '💾 Lưu thay đổi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: GENERATED PASSWORD DISPLAY */}
      {generatedPasswordToShow && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-content text-center" style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h3 className="modal-title">🔑 Thông tin tài khoản mới</h3>
              <button className="modal-close-btn" onClick={() => setGeneratedPasswordToShow('')}>×</button>
            </div>
            <div className="modal-body" style={{ padding: '20px' }}>
              <p className="text-muted" style={{ marginBottom: '15px', fontSize: '14px', lineHeight: '1.5', color: 'rgba(255,255,255,0.7)' }}>
                Thành viên mới đã được tạo thành công. Vui lòng copy và gửi mật khẩu ngẫu nhiên dưới đây cho nhân viên (Hệ thống không gửi qua Email):
              </p>
              <div style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px dashed rgba(255, 255, 255, 0.2)',
                padding: '12px',
                borderRadius: '8px',
                fontSize: '18px',
                fontWeight: 'bold',
                fontFamily: 'monospace',
                letterSpacing: '1px',
                color: '#00ff87',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '15px'
              }}>
                <span>{generatedPasswordToShow}</span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ padding: '4px 10px', fontSize: '12px' }}
                  onClick={() => {
                    navigator.clipboard.writeText(generatedPasswordToShow);
                    alert('Đã copy mật khẩu vào bộ nhớ tạm.');
                  }}
                >
                  📋 Copy
                </button>
              </div>
            </div>
            <div className="modal-footer" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn btn-gradient" style={{ width: '100%' }} onClick={() => setGeneratedPasswordToShow('')}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
