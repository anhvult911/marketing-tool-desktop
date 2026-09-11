import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';
import { PROFILES_DIR } from '@/lib/paths';
import { getAuthSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET: Xuất (Download) toàn bộ thư mục profiles/ thành file profiles_backup.zip
export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Chưa đăng nhập.' }, { status: 401 });
    }
    const profilesDir = PROFILES_DIR;

    if (!fs.existsSync(profilesDir)) {
      fs.mkdirSync(profilesDir, { recursive: true });
    }

    const zip = new AdmZip();
    
    // Đọc tất cả các thư mục profile bên trong profiles/
    const items = fs.readdirSync(profilesDir);
    let addedCount = 0;

    for (const item of items) {
      // Bỏ qua các file tạm, file lock, hoặc screenshot không cần thiết để tối ưu dung lượng
      if (item === 'screenshots' || item.endsWith('.tmp') || item.startsWith('.')) continue;

      const itemPath = path.join(/*turbopackIgnore: true*/ profilesDir, item);
      const stat = fs.statSync(itemPath);

      if (stat.isDirectory()) {
        zip.addLocalFolder(itemPath, item);
        addedCount++;
      }
    }

    if (addedCount === 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'Thư mục profiles hiện đang trống, chưa có phiên đăng nhập nào để xuất.' 
      }, { status: 400 });
    }

    const zipBuffer = zip.toBuffer();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `profiles_backup_${timestamp}.zip`;

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': zipBuffer.length.toString(),
      },
    });
  } catch (err: any) {
    console.error('[Sync-Profiles Export Error]:', err);
    return NextResponse.json({ 
      success: false, 
      error: `Lỗi xuất Profiles: ${err.message}` 
    }, { status: 500 });
  }
}

// POST: Nhập (Upload) file ZIP và giải nén trực tiếp vào thư mục profiles/
export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Chưa đăng nhập.' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ 
        success: false, 
        error: 'Vui lòng chọn file zip backup profiles để tải lên.' 
      }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const profilesDir = PROFILES_DIR;
    if (!fs.existsSync(profilesDir)) {
      fs.mkdirSync(profilesDir, { recursive: true });
    }

    const zip = new AdmZip(buffer);
    const zipEntries = zip.getEntries();

    if (zipEntries.length === 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'File zip không chứa dữ liệu profile hợp lệ.' 
      }, { status: 400 });
    }

    const safeBaseDir = path.resolve(profilesDir);

    // Giải nén từng entry có kiểm tra chống Zip Slip
    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;

      const targetPath = path.resolve(safeBaseDir, entry.entryName);
      if (!targetPath.startsWith(safeBaseDir + path.sep)) {
        console.warn(`[Security Alert] Chặn entry Zip Slip nguy hiểm trong sync-profiles: ${entry.entryName}`);
        continue;
      }

      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      fs.writeFileSync(targetPath, entry.getData());
    }

    // Đếm số lượng thư mục profile sau khi giải nén
    const updatedItems = fs.readdirSync(profilesDir).filter(item => {
      const p = path.join(/*turbopackIgnore: true*/ profilesDir, item);
      return fs.statSync(p).isDirectory() && item !== 'screenshots';
    });

    console.log(`[Sync-Profiles] Đã nạp thành công dữ liệu profiles. Tổng số profile hiện tại: ${updatedItems.length}`);

    return NextResponse.json({
      success: true,
      message: `Đã nhập và đồng bộ thành công ${updatedItems.length} profile tài khoản!`,
      profilesCount: updatedItems.length,
      profiles: updatedItems
    });
  } catch (err: any) {
    console.error('[Sync-Profiles Import Error]:', err);
    return NextResponse.json({ 
      success: false, 
      error: `Lỗi nhập Profiles: ${err.message}` 
    }, { status: 500 });
  }
}
