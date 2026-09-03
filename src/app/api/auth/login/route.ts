import { NextResponse } from 'next/server';
import { DEFAULT_DESKTOP_USER } from '@/lib/auth';

export async function POST() {
  return NextResponse.json({
    success: true,
    message: 'Đăng nhập thành công!',
    user: DEFAULT_DESKTOP_USER
  });
}
