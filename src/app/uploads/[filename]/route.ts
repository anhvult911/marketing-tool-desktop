import fs from 'fs';
import path from 'path';
import { UPLOADS_DIR } from '@/lib/paths';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ filename: string }> | { filename: string } }
) {
  try {
    // Resolve params safely (handles both Next.js 14 sync and Next.js 15/16 async params)
    const resolvedParams = await params;
    // Bóc tách tên file an toàn bằng path.basename, loại trừ mọi path traversal (.., /, \)
    const safeFilename = path.basename(resolvedParams.filename || '');
    if (!safeFilename || safeFilename === '.' || safeFilename.includes('..')) {
      return new Response('Tên tệp tin không hợp lệ.', { status: 400 });
    }
    
    const safeUploadsDir = path.resolve(UPLOADS_DIR);
    let filePath = path.resolve(safeUploadsDir, safeFilename);

    if (!filePath.startsWith(safeUploadsDir)) {
      return new Response('Truy cập bị từ chối.', { status: 403 });
    }

    if (!fs.existsSync(filePath)) {
      // Fallback kiểm tra thư mục public/uploads
      const safePublicDir = path.resolve(process.cwd(), 'public', 'uploads');
      const fallbackPath = path.resolve(safePublicDir, safeFilename);
      if (fallbackPath.startsWith(safePublicDir) && fs.existsSync(fallbackPath)) {
        filePath = fallbackPath;
      } else {
        return new Response('Không tìm thấy tệp tin.', { status: 404 });
      }
    }

    const fileBuffer = fs.readFileSync(filePath);
    
    // Determine the correct Content-Type based on file extension
    let contentType = 'application/octet-stream';
    const ext = path.extname(safeFilename).toLowerCase();
    
    if (ext === '.png') contentType = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    else if (ext === '.gif') contentType = 'image/gif';
    else if (ext === '.webp') contentType = 'image/webp';
    else if (ext === '.jfif') contentType = 'image/jpeg';
    else if (ext === '.mp4') contentType = 'video/mp4';
    else if (ext === '.webm') contentType = 'video/webm';
    else if (ext === '.mov') contentType = 'video/quicktime';

    return new Response(new Uint8Array(fileBuffer), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err: any) {
    return new Response('Lỗi đọc tệp tin: ' + err.message, { status: 500 });
  }
}
