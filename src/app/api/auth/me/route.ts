import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const session = await getAuthSession(request);
    return NextResponse.json({ success: true, user: session });
  } catch (error) {
    return NextResponse.json({ error: 'Lỗi hệ thống' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { fullName } = await request.json();
    return NextResponse.json({ success: true, message: 'Cập nhật thành công', fullName });
  } catch (error: any) {
    return NextResponse.json({ error: 'Lỗi hệ thống.' }, { status: 500 });
  }
}
