import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { getAuthSession } from '@/lib/auth';
import { UPLOADS_DIR } from '@/lib/paths';

export async function POST(request: Request) {
  try {
    const session = await getAuthSession(request);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Chưa đăng nhập.' }, { status: 401 });
    }

    if (session.role === 'viewer') {
      return NextResponse.json({ success: false, error: 'Bạn không có quyền thực hiện tác vụ này.' }, { status: 403 });
    }

    const formData = await request.formData();
    const files = formData.getAll('files') as File[];

    if (!files || files.length === 0) {
      return NextResponse.json({ success: false, error: 'Không tìm thấy tệp tải lên.' }, { status: 400 });
    }

    const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm', '.mov']);
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

    const uploadDir = UPLOADS_DIR;
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const savedPaths: string[] = [];

    for (const file of files) {
      if (!(file instanceof File)) continue;

      const ext = path.extname(file.name || '').toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        return NextResponse.json({ 
          success: false, 
          error: `Định dạng tệp "${file.name}" không được hỗ trợ. Chỉ cho phép các định dạng hình ảnh/video: ${Array.from(ALLOWED_EXTENSIONS).join(', ')}` 
        }, { status: 400 });
      }

      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json({ 
          success: false, 
          error: `Tệp tin "${file.name}" vượt quá dung lượng tối đa cho phép (50MB).` 
        }, { status: 400 });
      }

      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      // Generate a unique safe filename
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const filename = `${uniqueSuffix}${ext}`;
      const filePath = path.join(uploadDir, filename);

      fs.writeFileSync(filePath, buffer);
      savedPaths.push(`/uploads/${filename}`);
    }

    return NextResponse.json({
      success: true,
      message: `Đã tải lên thành công ${savedPaths.length} tệp.`,
      paths: savedPaths
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
