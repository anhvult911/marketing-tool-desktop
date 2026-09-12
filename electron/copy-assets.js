const fs = require('fs');
const path = require('path');

function copyFolderSync(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from).forEach((element) => {
    const fromPath = path.join(from, element);
    const toPath = path.join(to, element);
    if (fs.lstatSync(fromPath).isDirectory()) {
      copyFolderSync(fromPath, toPath);
    } else {
      fs.copyFileSync(fromPath, toPath);
    }
  });
}

const root = path.resolve(__dirname, '..');
const standaloneStatic = path.join(root, '.next', 'standalone', '.next', 'static');
const originalStatic = path.join(root, '.next', 'static');
const standalonePublic = path.join(root, '.next', 'standalone', 'public');
const originalPublic = path.join(root, 'public');

console.log('[Build] Copying static assets to .next/standalone...');
copyFolderSync(originalStatic, standaloneStatic);
copyFolderSync(originalPublic, standalonePublic);

// Fix Next.js 16 Turbopack tracing omission for app-route-turbo runtimes
const originalNextServer = path.join(root, 'node_modules', 'next', 'dist', 'compiled', 'next-server');
const standaloneNextServer = path.join(root, '.next', 'standalone', 'node_modules', 'next', 'dist', 'compiled', 'next-server');
if (fs.existsSync(originalNextServer)) {
  console.log('[Build] Copying missing next-server runtimes to standalone...');
  copyFolderSync(originalNextServer, standaloneNextServer);
}

// Ensure Playwright browsers.json is copied into standalone node_modules
const originalBrowsersJson = path.join(root, 'node_modules', 'playwright-core', 'browsers.json');
const standaloneBrowsersJson = path.join(root, '.next', 'standalone', 'node_modules', 'playwright-core', 'browsers.json');
if (fs.existsSync(originalBrowsersJson)) {
  console.log('[Build] Copying playwright browsers.json to standalone...');
  const parentDir = path.dirname(standaloneBrowsersJson);
  if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
  fs.copyFileSync(originalBrowsersJson, standaloneBrowsersJson);
}

// Copy better-sqlite3 native compiled binary to standalone
const originalBetterSqlite = path.join(root, 'node_modules', 'better-sqlite3', 'build');
const standaloneBetterSqlite = path.join(root, '.next', 'standalone', 'node_modules', 'better-sqlite3', 'build');
if (fs.existsSync(originalBetterSqlite)) {
  console.log('[Build] Copying better-sqlite3 native build to standalone...');
  copyFolderSync(originalBetterSqlite, standaloneBetterSqlite);
}

// Copy dist-worker into standalone to unify the execution environment
const originalWorker = path.join(root, 'dist-worker');
const standaloneWorker = path.join(root, '.next', 'standalone', 'dist-worker');
if (fs.existsSync(originalWorker)) {
  console.log('[Build] Copying dist-worker to standalone execution environment...');
  copyFolderSync(originalWorker, standaloneWorker);
}

/**
 * Dọn rác khỏi standalone.
 *
 * Vì sao cần: bộ trace (NFT) của Next copy nhầm source/thư mục dữ liệu khi gặp đường
 * dẫn fs động, VÀ nó không xoá file rác của lần build trước — đã kiểm chứng một file
 * `.ts` được trace từ 02-09 vẫn còn nguyên trong standalone sau nhiều lần build.
 * Không dọn thì rác cũ bị đóng gói thẳng vào installer.
 *
 * Dùng danh sách CHẶN tường minh (không phải danh sách cho phép) để không có nguy cơ
 * xoá nhầm thứ runtime cần: giữ nguyên .next, node_modules, public, server.js,
 * package.json, dist-worker và mọi file khác không nằm trong danh sách.
 */
const STANDALONE_JUNK = [
  'src', 'scripts', 'electron', '.github',
  'tsconfig.json', 'tsconfig.electron.json', 'tsconfig.tsbuildinfo',
  'electron-builder.json', 'next.config.ts', 'next-env.d.ts',
  'MIGRATION_PLAN.md', 'README.md', 'update-policy.json',
  'marketing.db', 'marketing.db-shm', 'marketing.db-wal',
  '.env', '.env.example',
];

function pruneStandalone() {
  const standaloneRoot = path.join(root, '.next', 'standalone');
  if (!fs.existsSync(standaloneRoot)) return;
  const removed = [];
  for (const entry of STANDALONE_JUNK) {
    const target = path.join(standaloneRoot, entry);
    if (!fs.existsSync(target)) continue;
    try {
      fs.rmSync(target, { recursive: true, force: true });
      removed.push(entry);
    } catch (err) {
      // Thường gặp với junction/symlink trên Windows — không chặn build, chỉ cảnh báo.
      console.warn(`[Build] ⚠️ Không dọn được ${entry} khỏi standalone: ${err.message}`);
    }
  }
  if (removed.length > 0) {
    console.log(`[Build] 🧹 Đã dọn khỏi standalone: ${removed.join(', ')}`);
  }
}

pruneStandalone();

console.log('[Build] ✅ All static assets, worker, native binaries, and runtimes copied successfully to standalone.');
