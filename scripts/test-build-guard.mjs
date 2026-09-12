#!/usr/bin/env node
/**
 * Test cho build guard (P1/P2). Chạy: node scripts/test-build-guard.mjs
 *
 * Gồm 2 tầng:
 *  1) Bộ lọc process (thuần dữ liệu) — dùng cmdline THẬT đã thu trên máy này.
 *  2) Test khoá THẬT: spawn một process giữ binding native rồi kiểm tra guard
 *     phát hiện đúng (không phụ thuộc việc dev server của người dùng có chạy hay không).
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  PROJECT_ROOT,
  rootNativeBinaryPath,
  checkNativeWritable,
  findDevProcesses,
  findModuleHolders,
  killProcessTree,
} from './lib/build-guard.mjs';

let fail = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    console.error(`  ✗ ${name}`, detail !== undefined ? `→ ${JSON.stringify(detail).slice(0, 220)}` : '');
    fail++;
  }
}

const ROOT = PROJECT_ROOT;
const OTHER_ROOT = 'D:\\Projects\\marketing-tool';

console.log('— findDevProcesses: nhận diện stack dev —');
{
  const cases = [
    ['next dev', `"node" "${ROOT}\\node_modules\\.bin\\..\\next\\dist\\bin\\next" dev -H 127.0.0.1 -p 3000`, true],
    ['next start-server', `node ${ROOT}\\node_modules\\next\\dist\\server\\lib\\start-server.js`, true],
    ['concurrently', `"node" "${ROOT}\\node_modules\\.bin\\..\\concurrently\\dist\\bin\\index.js" -k -n "Next,Electron"`, true],
    ['tsx dev-runner', `"node" "${ROOT}\\node_modules\\.bin\\..\\tsx\\dist\\cli.mjs" electron/dev-runner.ts`, true],
    ['electron dev binary', `${ROOT}\\node_modules\\electron\\dist\\electron.exe .`, true],
    ['dev worker', `node ${ROOT}\\dist-worker\\worker\\worker.js`, true],
  ];
  for (const [label, cmdline, expected] of cases) {
    const matched = findDevProcesses([{ pid: 1, name: 'node.exe', cmdline }], ROOT);
    check(`nhận diện: ${label}`, matched.length === 1, { label, matched: matched.length });
  }
}

console.log('— findDevProcesses: KHÔNG được giết nhầm —');
{
  const notDev = [
    ['app đã cài (Program Files)', `C:\\Users\\x\\AppData\\Local\\Programs\\MKT Tools Desktop\\MKT Tools Desktop.exe`],
    ['app đóng gói chạy từ dist', `${ROOT}\\dist\\win-unpacked\\MKT Tools Desktop.exe`],
    ['worker trong app đóng gói', `${ROOT}\\dist\\win-unpacked\\resources\\standalone\\dist-worker\\worker\\worker.js`],
    ['standalone server trong app đóng gói', `${ROOT}\\dist\\win-unpacked\\resources\\standalone\\server.js`],
    ['dự án khác đang dev', `${OTHER_ROOT}\\node_modules\\next\\dist\\bin\\next dev`],
    ['agent/CLI khác trong repo', `node ${ROOT}\\node_modules\\@openai\\codex\\bin\\codex.js -c approval_policy=never`],
    ['script test của repo', `node ${ROOT}\\scripts\\test-build-guard.mjs`],
    ['process không có cmdline', ''],
  ];
  let pid = 100;
  const all = notDev.map(([label, cmdline]) => ({ pid: pid++, name: 'node.exe', cmdline, label }));
  const matched = findDevProcesses(all, ROOT);
  check('không process nào bị nhận nhầm là dev', matched.length === 0, matched.map(m => m.label));
}

console.log('— checkNativeWritable —');
{
  const missing = path.join(ROOT, 'node_modules', 'better-sqlite3', 'build', 'Release', '__khong_ton_tai__.node');
  const m = checkNativeWritable(missing);
  check('file chưa tồn tại → coi như ghi được (bản cài mới)', m.ok === true && m.missing === true, m);

  const real = checkNativeWritable(rootNativeBinaryPath(ROOT));
  check('binding thật đọc được trạng thái', typeof real.ok === 'boolean', real);
}

console.log('— KHOÁ THẬT: process giữ binding native —');
{
  const binding = rootNativeBinaryPath(ROOT);
  if (!fs.existsSync(binding)) {
    check('có binding native để test', false, binding);
  } else {
    /**
     * Chờ binding rảnh trước khi bắt đầu: nếu chạy ngay sau suite khác, tiến trình node
     * vừa thoát có thể còn giữ file vài giây → test trước đây chập chờn (pass khi chạy
     * riêng, fail khi chạy trong chuỗi). Đây là ổn định hoá test, không phải nới lỏng.
     */
    const settleDeadline = Date.now() + 20_000;
    while (Date.now() < settleDeadline && !checkNativeWritable(binding).ok) {
      execFileSync(process.execPath, ['-e', 'setTimeout(function(){},500)']);
    }
    const settledState = checkNativeWritable(binding);
    check('binding rảnh trước khi test (không bị tiến trình khác giữ)', settledState.ok,
      settledState.ok ? undefined : `còn bị giữ: ${settledState.code}`);

    // Process giả: MỞ DB thật rồi sống mãi. Lưu ý better-sqlite3 v12 nạp binding
    // LAZY — chỉ `require` là chưa map file, phải `new Database()` mới khoá.
    const decoy = spawn(
      process.execPath,
      ['-e', "var D=require('better-sqlite3');var db=new D(':memory:');setInterval(function(){},1000)"],
      { cwd: ROOT, stdio: 'ignore', windowsHide: true }
    );

    const deadline = Date.now() + 15_000;
    let locked = false;
    while (Date.now() < deadline) {
      if (!checkNativeWritable(binding).ok) { locked = true; break; }
      execFileSync(process.execPath, ['-e', 'setTimeout(function(){},300)']);
    }

    check('giữ file thành công (mô phỏng đúng lỗi EBUSY)', locked, { pid: decoy.pid });

    if (locked) {
      const holders = findModuleHolders();
      const decoyListed = holders.some(h => h.pid === decoy.pid);
      check('findModuleHolders chỉ đúng process đang giữ file', decoyListed, {
        decoy: decoy.pid,
        found: holders.map(h => h.pid),
      });

      let exitCode = 0;
      let stderr = '';
      try {
        execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'check-native-lock.mjs')], {
          cwd: ROOT, encoding: 'utf8', windowsHide: true,
        });
      } catch (err) {
        exitCode = err.status ?? 1;
        stderr = String(err.stderr || '');
      }
      check('guard CLI thoát với mã lỗi (chặn build)', exitCode === 1, { exitCode });
      check('guard CLI nêu đúng PID đang giữ file', stderr.includes(String(decoy.pid)), stderr.slice(0, 200));
      check('guard CLI hướng dẫn cách xử lý', stderr.includes('stop:dev') || stderr.includes('Ctrl+C'), stderr.slice(0, 300));
    }

    const killed = killProcessTree(decoy.pid);
    check('killProcessTree tắt được process giả', killed.ok === true, killed);

    const releaseDeadline = Date.now() + 10_000;
    let released = false;
    while (Date.now() < releaseDeadline) {
      if (checkNativeWritable(binding).ok) { released = true; break; }
      execFileSync(process.execPath, ['-e', 'setTimeout(function(){},300)']);
    }
    check('sau khi tắt process, file ghi được trở lại', released);

    let okExit = 1;
    let stdout = '';
    try {
      stdout = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'check-native-lock.mjs')], {
        cwd: ROOT, encoding: 'utf8', windowsHide: true,
      });
      okExit = 0;
    } catch (err) {
      okExit = err.status ?? 1;
      stdout = String(err.stdout || '');
    }
    check('guard CLI cho qua khi không còn ai giữ file', okExit === 0 && stdout.includes('✅'), { okExit, stdout: stdout.slice(0, 160) });
  }
}

console.log('— stop:dev: liệt kê + tắt process dev —');
{
  const runCli = (script, args = []) => {
    try {
      const stdout = execFileSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], {
        cwd: ROOT, encoding: 'utf8', windowsHide: true,
      });
      return { code: 0, stdout, stderr: '' };
    } catch (err) {
      return { code: err.status ?? 1, stdout: String(err.stdout || ''), stderr: String(err.stderr || '') };
    }
  };

  // Không có dev nào đang chạy → phải cho qua (không tắt gì, không lỗi).
  const idle = runCli('stop-dev.mjs');
  check('khi không có dev → thoát 0 và không tắt gì', idle.code === 0 && idle.stdout.includes('Không có process dev nào'), idle.stdout.slice(0, 200));

  // Process giả khớp marker dev: cmdline chứa gốc dự án + "dev-runner.ts", và mở DB
  // thật nên đang giữ binding native.
  const decoy = spawn(
    process.execPath,
    ['-e', `/* ${ROOT}\\electron\\dev-runner.ts */ var D=require('better-sqlite3');var db=new D(':memory:');setInterval(function(){},1000)`],
    { cwd: ROOT, stdio: 'ignore', windowsHide: true }
  );

  const exited = Promise.withResolvers();
  decoy.on('exit', () => exited.resolve(true));

  const binding = rootNativeBinaryPath(ROOT);
  const deadline = Date.now() + 15_000;
  let locked = false;
  while (Date.now() < deadline) {
    if (!checkNativeWritable(binding).ok) { locked = true; break; }
    execFileSync(process.execPath, ['-e', 'setTimeout(function(){},300)']);
  }
  check('process giả đang giữ binding native', locked, { pid: decoy.pid });

  const dry = runCli('stop-dev.mjs', ['--dry-run']);
  check('--dry-run liệt kê process giả, không tắt', dry.code === 0 && dry.stdout.includes(String(decoy.pid)) && dry.stdout.includes('--dry-run'), dry.stdout.slice(0, 260));
  check('--dry-run để process tiếp tục sống', checkNativeWritable(binding).ok === false);

  const real = runCli('stop-dev.mjs');
  check('stop:dev thoát 0 và báo giải phóng file', real.code === 0 && real.stdout.includes('giải phóng file native'), { code: real.code, out: real.stdout.slice(-200), err: real.stderr.slice(0, 200) });
  check('stop:dev có nhắc PID đã tắt', real.stdout.includes(String(decoy.pid)), real.stdout.slice(0, 260));

  const exitedInTime = await Promise.race([
    exited.promise,
    new Promise((resolve) => setTimeout(() => resolve(false), 10_000)),
  ]);
  check('process giả đã bị tắt', exitedInTime === true, { pid: decoy.pid });
  check('binding native ghi được sau khi tắt', checkNativeWritable(binding).ok === true);
}

console.log(fail === 0 ? '\n✓ BUILD GUARD PASSED' : `\n✗ BUILD GUARD FAILED (${fail})`);
process.exit(fail === 0 ? 0 : 1);
