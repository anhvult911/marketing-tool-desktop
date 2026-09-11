import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';
import { DB_PATH, PROFILES_DIR } from '@/lib/paths';
import { getAuthSession } from '@/lib/auth';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET: Tải về bản Sao lưu Toàn diện (Full Backup .zip) gồm CSDL mkt.db và thư mục profiles
export async function GET(request: Request) {
  try {
    const session = await getAuthSession(request);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Chưa đăng nhập.' }, { status: 401 });
    }

    const zip = new AdmZip();

    // 1. Sao lưu file CSDL SQLite mkt.db
    if (fs.existsSync(DB_PATH)) {
      try {
        // Sử dụng lệnh checkpoint WAL của SQLite trước khi đọc để đảm bảo dữ liệu mới nhất
        db.pragma('wal_checkpoint(TRUNCATE)');
        const dbBuffer = fs.readFileSync(DB_PATH);
        zip.addFile('mkt.db', dbBuffer);
      } catch (dbErr: any) {
        console.warn('[Full Backup] Không thể đọc trực tiếp mkt.db:', dbErr.message);
      }
    }

    // 2. Sao lưu các phiên đăng nhập (profiles)
    if (fs.existsSync(PROFILES_DIR)) {
      const items = fs.readdirSync(PROFILES_DIR);
      for (const item of items) {
        if (item === 'screenshots' || item.endsWith('.tmp') || item.startsWith('.')) continue;

        const itemPath = path.join(/*turbopackIgnore: true*/ PROFILES_DIR, item);
        try {
          const stat = fs.statSync(itemPath);
          if (stat.isDirectory()) {
            zip.addLocalFolder(itemPath, `profiles/${item}`);
          }
        } catch {}
      }
    }

    const zipBuffer = zip.toBuffer();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `mkt_full_backup_${timestamp}.zip`;

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': zipBuffer.length.toString(),
      },
    });
  } catch (err: any) {
    console.error('[Backup Error]:', err);
    return NextResponse.json({ success: false, error: `Lỗi tạo bản sao lưu: ${err.message}` }, { status: 500 });
  }
}

// POST: Khôi phục toàn bộ CSDL và tài khoản từ file zip
export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession(request);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Chưa đăng nhập.' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ success: false, error: 'Vui lòng chọn file .zip để khôi phục.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const zip = new AdmZip(buffer);
    const zipEntries = zip.getEntries();

    let hasDatabase = false;
    let restoredProfilesCount = 0;

    // 1. Phục hồi CSDL mkt.db nếu có trong file zip
    const dbEntry = zipEntries.find(e => e.entryName === 'mkt.db' || e.entryName.endsWith('/mkt.db'));
    if (dbEntry) {
      try {
        const dbData = dbEntry.getData();
        // Ghi đè file CSDL
        fs.writeFileSync(DB_PATH, dbData);
        hasDatabase = true;
      } catch (dbErr: any) {
        console.error('[Restore Error] Ghi đè CSDL thất bại:', dbErr.message);
      }
    }

    // 2. Phục hồi thư mục profiles
    if (!fs.existsSync(PROFILES_DIR)) {
      fs.mkdirSync(PROFILES_DIR, { recursive: true });
    }

    const safeBaseDir = path.resolve(PROFILES_DIR);

    for (const entry of zipEntries) {
      if (entry.entryName.startsWith('profiles/') && !entry.isDirectory) {
        const relativePath = entry.entryName.replace(/^profiles\//, '');
        // Bảo vệ chống lỗ hổng Zip Slip (Path Traversal)
        const targetPath = path.resolve(safeBaseDir, relativePath);
        if (!targetPath.startsWith(safeBaseDir + path.sep)) {
          console.warn(`[Security Alert] Phát hiện và chặn entry Zip Slip nguy hiểm: ${entry.entryName}`);
          continue;
        }

        const targetDir = path.dirname(targetPath);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        fs.writeFileSync(targetPath, entry.getData());
        restoredProfilesCount++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Khôi phục thành công! Đã phục hồi ${hasDatabase ? 'CSDL mkt.db' : ''} và ${restoredProfilesCount} tệp tin phiên đăng nhập. Vui lòng tải lại trang.`,
      hasDatabase,
      restoredProfilesCount
    });
  } catch (err: any) {
    console.error('[Restore Error]:', err);
    return NextResponse.json({ success: false, error: `Lỗi khôi phục: ${err.message}` }, { status: 500 });
  }
}
