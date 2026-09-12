/**
 * BUILD GUARD — logic dùng chung cho các bước kiểm tra trước/sau khi đóng gói.
 *
 * Lý do tồn tại: `npm run build:next` mở đầu bằng `npm rebuild better-sqlite3`,
 * lệnh này phải GHI ĐÈ file native `better_sqlite3.node`. Trên Windows, nếu file
 * đang được process khác map vào bộ nhớ (stack `npm run dev`), thao tác đó thất bại:
 *   - prebuild-install → EBUSY: resource busy or locked
 *   - node-gyp (fallback) → EPERM: operation not permitted, unlink
 * (đã tái hiện đúng cả hai mã lỗi này trên máy thật).
 *
 * Linux/macOS cho phép xoá file đang mở nên lỗi chỉ xuất hiện trên Windows.
 *
 * Module này tách phần LOGIC (thuần, test được) khỏi phần SIDE EFFECT (taskkill),
 * để bộ lọc process có thể kiểm thử bằng dữ liệu tổng hợp.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Gốc repo (scripts/lib → ../..). */
export const PROJECT_ROOT = path.resolve(HERE, '..', '..');

/** Tên file native mà better-sqlite3 nạp lúc chạy. */
export const NATIVE_MODULE = 'better_sqlite3.node';

/** Đường dẫn binding native trong node_modules gốc. */
export function rootNativeBinaryPath(root = PROJECT_ROOT) {
  return path.join(root, 'node_modules', 'better-sqlite3', 'build', 'Release', NATIVE_MODULE);
}

/** Binding native mà app đã đóng gói dùng (do @electron/rebuild sinh ra). */
export function standaloneNativeBinaryPath(root = PROJECT_ROOT) {
  return path.join(root, '.next', 'standalone', 'node_modules', 'better-sqlite3', 'build', 'Release', NATIVE_MODULE);
}

/**
 * Thử mở file để GHI — đúng thao tác mà `npm rebuild` cần.
 * Trả { ok, code?, message? }. File chưa tồn tại cũng tính là "ghi được"
 * (bản cài mới chưa có binding; prebuild-install sẽ tạo).
 */
export function checkNativeWritable(file) {
  if (!fs.existsSync(file)) {
    return { ok: true, missing: true };
  }
  try {
    const fd = fs.openSync(file, 'r+');
    fs.closeSync(fd);
    return { ok: true, missing: false };
  } catch (err) {
    return {
      ok: false,
      missing: false,
      code: err?.code || 'UNKNOWN',
      message: err?.message || String(err),
    };
  }
}

/** Chạy PowerShell với script đã mã hoá base64 — tránh mọi vấn đề escaping quote. */
export function runPowerShell(script, timeoutMs = 60_000) {
  // $ProgressPreference: chặn record "Preparing modules for first use" làm bẩn stdout.
  const wrapped = `$ProgressPreference = 'SilentlyContinue'\n${script}`;
  const encoded = Buffer.from(wrapped, 'utf16le').toString('base64');
  const stdout = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true }
  );
  return stdout;
}

/**
 * Parse JSON do PowerShell trả về, chuẩn hoá mảng 0/1 phần tử.
 * NÉM lỗi khi có output nhưng không parse được: trả [] im lặng sẽ khiến guard báo
 * "không có process nào giữ file" trong khi thực tế là không đọc được — sai lệch
 * nguy hiểm (false negative) đúng ở chỗ cần chặn.
 */
function parseProcessJson(stdout) {
  const text = (stdout || '').trim();
  if (!text) return [];
  const start = text.search(/[[{]/);
  if (start < 0) throw new Error(`PowerShell không trả JSON: ${text.slice(0, 120)}`);
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start));
  } catch (err) {
    throw new Error(`JSON từ PowerShell không hợp lệ: ${err?.message || err}`);
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') return [parsed];
  return [];
}

const PROCESS_FILTER = "Name='node.exe' or Name='electron.exe' or Name='MKT Tools Desktop.exe'";

/** Liệt kê process node/electron kèm cmdline (đã chuẩn hoá mảng). */
export function listNodeProcesses() {
  const script = `
$out = @()
foreach ($p in Get-CimInstance Win32_Process -Filter "${PROCESS_FILTER}") {
  $out += [pscustomobject]@{ pid = $p.ProcessId; name = $p.Name; cmdline = $p.CommandLine }
}
ConvertTo-Json -InputObject @($out) -Compress -Depth 3
`;
  return parseProcessJson(runPowerShell(script)).filter(
    (p) => p && typeof p.pid === 'number'
  ).map((p) => ({
    pid: p.pid,
    name: typeof p.name === 'string' ? p.name : '',
    cmdline: typeof p.cmdline === 'string' ? p.cmdline : '',
  }));
}

/** Process nào đang map file native vào bộ nhớ (thủ phạm gây EBUSY/EPERM). */
export function findModuleHolders(moduleName = NATIVE_MODULE) {
  const safeName = String(moduleName).replace(/[^A-Za-z0-9._-]/g, '');
  const script = `
$target = '${safeName}'
$out = @()
foreach ($p in Get-CimInstance Win32_Process -Filter "${PROCESS_FILTER}") {
  try {
    $pr = Get-Process -Id $p.ProcessId -ErrorAction Stop
    $m = $pr.Modules | Where-Object { $_.ModuleName -eq $target } | Select-Object -First 1
    if ($m) {
      $out += [pscustomobject]@{ pid = $p.ProcessId; name = $p.Name; module = $m.FileName; cmdline = $p.CommandLine }
    }
  } catch { }
}
ConvertTo-Json -InputObject @($out) -Compress -Depth 3
`;
  return parseProcessJson(runPowerShell(script, 120_000)).map((p) => ({
    pid: p.pid,
    name: typeof p.name === 'string' ? p.name : '',
    module: typeof p.module === 'string' ? p.module : '',
    cmdline: typeof p.cmdline === 'string' ? p.cmdline : '',
  }));
}

/**
 * Dấu hiệu process thuộc stack DEV của CHÍNH repo này.
 * Mỗi mục: mô tả + chuỗi phải xuất hiện trong cmdline (đã hạ chữ thường).
 */
const DEV_MARKERS = [
  ['next dev/start', 'next\\dist\\bin\\next'],
  ['next dev server', 'next\\dist\\server\\lib\\start-server.js'],
  ['concurrently (dev orchestrator)', 'concurrently\\dist\\bin\\index.js'],
  ['electron dev runner', 'dev-runner.ts'],
  ['electron dev binary', 'node_modules\\electron\\dist\\electron.exe'],
  ['dev worker', 'dist-worker\\worker\\worker.js'],
];

/**
 * Dấu hiệu process thuộc APP ĐÃ ĐÓNG GÓI (dù chạy từ thư mục dự án).
 * Loại trừ trước để `stop:dev` không bao giờ giết nhầm app người dùng đang mở.
 */
const PACKAGED_MARKERS = ['\\win-unpacked\\', '\\resources\\standalone\\', '\\resources\\app.asar'];

/**
 * Lọc danh sách process thành các process DEV của repo này.
 * Điều kiện: cmdline chứa gốc dự án + khớp marker dev + KHÔNG phải app đóng gói.
 * Thuần dữ liệu → test được bằng danh sách tổng hợp.
 */
export function findDevProcesses(processes, projectRoot = PROJECT_ROOT) {
  const rootNeedle = projectRoot.toLowerCase().replace(/\//g, '\\');
  const matched = [];
  for (const proc of processes) {
    const cmd = (proc.cmdline || '').toLowerCase().replace(/\//g, '\\');
    if (!cmd || !cmd.includes(rootNeedle)) continue;
    if (PACKAGED_MARKERS.some((m) => cmd.includes(m))) continue;
    const marker = DEV_MARKERS.find(([, needle]) => cmd.includes(needle));
    if (!marker) continue;
    matched.push({ pid: proc.pid, name: proc.name || '', label: marker[0], cmdline: proc.cmdline || '' });
  }
  return matched;
}

/** Tắt cả cây process (taskkill /T) — chỉ gọi với pid đã lọc kỹ. */
export function killProcessTree(pid) {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err?.message || String(err) };
  }
}

/** File tạm để chạy phép thử chức năng binding dưới một runtime bất kỳ. */
export function writeAbiProbe() {
  const probePath = path.join(os.tmpdir(), `mkt-abi-probe-${process.pid}.cjs`);
  fs.writeFileSync(
    probePath,
    [
      'const target = process.argv[2];',
      'try {',
      '  const Database = require(target);',
      "  const db = new Database(':memory:');",
      '  db.exec("CREATE TABLE t(a)");',
      '  db.prepare("INSERT INTO t VALUES (?)").run(42);',
      '  const row = db.prepare("SELECT a FROM t").get();',
      '  db.close();',
      '  console.log("OK:" + row.a);',
      '} catch (e) {',
      '  console.log("FAIL:" + String(e.message).split("\\n")[0]);',
      '}',
      '',
    ].join('\n'),
    'utf8'
  );
  return probePath;
}

/**
 * Thử NẠP THẬT binding dưới một runtime (node hoặc electron) rồi ghi/đọc dữ liệu.
 * Dùng để phân biệt ABI thay vì chỉ `require` (require có thể thành công
 * nhưng binding sai ABI vẫn ném lỗi khi dùng).
 */
export function probeRuntime(runtimeExe, bindingDir, extraEnv = {}) {
  const probePath = writeAbiProbe();
  const modulePath = path.join(bindingDir, 'build', 'Release', NATIVE_MODULE);
  try {
    const out = execFileSync(runtimeExe, [probePath, bindingDir], {
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true,
      env: { ...process.env, ...extraEnv },
    });
    const line = String(out).trim().split('\n').pop() || '';
    if (line.startsWith('OK:')) return { ok: true, detail: line.slice(3) };
    return { ok: false, detail: line.replace(/^FAIL:/, '') };
  } catch (err) {
    return { ok: false, detail: err?.message || String(err) };
  } finally {
    try {
      fs.unlinkSync(probePath);
    } catch {
      // dọn file tạm thất bại không quan trọng
    }
  }
}

/** Đường dẫn electron binary của repo. */
export function electronBinaryPath(root = PROJECT_ROOT) {
  const exe = process.platform === 'win32' ? 'electron.exe' : 'electron';
  return path.join(root, 'node_modules', 'electron', 'dist', exe);
}

/**
 * Thư mục package better-sqlite3 chứa một binding.
 * binding = <pkg>/build/Release/better_sqlite3.node → lên 3 cấp là <pkg>.
 */
export function packageDirFor(binaryPath) {
  return path.dirname(path.dirname(path.dirname(binaryPath)));
}
