export interface SessionUser {
  userId: number;
  email: string;
  fullName: string;
  isSuperAdmin: boolean;
  activeWorkspaceId: number;
  role: string; // 'admin', 'staff', 'viewer'
}

// User mặc định cho môi trường Desktop App
export const DEFAULT_DESKTOP_USER: SessionUser = {
  userId: 1,
  email: 'admin@desktop.local',
  fullName: 'Desktop Admin',
  isSuperAdmin: true,
  activeWorkspaceId: 1,
  role: 'admin',
};

/**
 * Trong Desktop App, người dùng luôn có session admin local
 */
export async function getAuthSession(_req?: Request): Promise<SessionUser | null> {
  return DEFAULT_DESKTOP_USER;
}

export async function hashPassword(password: string): Promise<string> {
  return password;
}

export async function verifyPassword(_password: string, _hash: string): Promise<boolean> {
  return true;
}

export async function signJWT(payload: Record<string, any>): Promise<string> {
  return JSON.stringify(payload);
}

export async function verifyJWT(_token: string): Promise<any> {
  return DEFAULT_DESKTOP_USER;
}
