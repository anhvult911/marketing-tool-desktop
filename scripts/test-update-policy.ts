/**
 * Unit test cho chính sách cập nhật (so sánh version, kiểm tra policy, mức ép buộc)
 * + kiểm tra hằng số owner/repo KHÔNG lệch electron-builder.json (cùng loại lỗi với
 * vụ artifactName/feed lệch tên file trước đây).
 *
 * Chạy: npx tsx scripts/test-update-policy.ts
 */
import fs from 'fs';
import path from 'path';
import {
  compareVersions, parsePolicy, evaluatePolicy, DEFAULT_POLICY,
  GITHUB_OWNER, GITHUB_REPO, POLICY_URL, POLICY_ASSET_NAME,
} from '../electron/update-policy';

let fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ''); fail++; }
}

console.log('— compareVersions —');
check('bằng nhau', compareVersions('1.0.0', '1.0.0') === 0);
check('bỏ tiền tố v', compareVersions('v1.2.3', '1.2.3') === 0);
check('thiếu đoạn = 0', compareVersions('1.0', '1.0.0') === 0);
check('1.0.1 > 1.0.0', compareVersions('1.0.1', '1.0.0') === 1);
check('1.0.0 < 1.0.1', compareVersions('1.0.0', '1.0.1') === -1);
check('so số học không phải chuỗi: 1.10.0 > 1.9.0', compareVersions('1.10.0', '1.9.0') === 1, compareVersions('1.10.0', '1.9.0'));
check('1.2.0 > 1.1.99', compareVersions('1.2.0', '1.1.99') === 1);
check('2.0.0 > 1.99.99', compareVersions('2.0.0', '1.99.99') === 1);
check('prerelease < bản chính thức', compareVersions('1.0.0-beta', '1.0.0') === -1);
check('bản chính thức > prerelease', compareVersions('1.0.0', '1.0.0-beta') === 1);
check('prerelease.2 < prerelease.10 (số học)', compareVersions('1.0.0-beta.2', '1.0.0-beta.10') === -1, compareVersions('1.0.0-beta.2', '1.0.0-beta.10'));
check('chuỗi rỗng coi như 0.0.0', compareVersions('', '0.0.0') === 0);
check('rác không ném lỗi', compareVersions('abc', '1.0.0') === -1, compareVersions('abc', '1.0.0'));

console.log('— parsePolicy —');
check('JSON hợp lệ đọc đúng', (() => {
  const p = parsePolicy({ minimumVersion: '1.2.0', recommendedVersion: '1.3.0', message: 'Bắt buộc do đổi CSDL' });
  return p?.minimumVersion === '1.2.0' && p?.recommendedVersion === '1.3.0' && p?.message === 'Bắt buộc do đổi CSDL';
})());
check('thiếu trường → mặc định 0.0.0 (không ép)', (() => {
  const p = parsePolicy({});
  return p?.minimumVersion === '0.0.0' && p?.recommendedVersion === '0.0.0';
})());
check('cắt khoảng trắng', parsePolicy({ minimumVersion: '  1.0.1  ' })?.minimumVersion === '1.0.1');
check('chấp nhận tiền tố v', parsePolicy({ minimumVersion: 'v1.0.1' })?.minimumVersion === 'v1.0.1');
check('null → null', parsePolicy(null) === null);
check('mảng → null', parsePolicy([1, 2]) === null);
check('chuỗi → null', parsePolicy('1.0.0') === null);
check('số → null', parsePolicy(5) === null);
check('version rác ("latest") → null (không được khoá user)', parsePolicy({ minimumVersion: 'latest' }) === null);
check('version rác ("*") → null', parsePolicy({ minimumVersion: '*' }) === null);
check('khoảng trắng thành chuỗi rỗng → về 0.0.0', parsePolicy({ minimumVersion: '   ' })?.minimumVersion === '0.0.0');

console.log('— evaluatePolicy —');
check('mặc định → none', evaluatePolicy('1.0.0', DEFAULT_POLICY).level === 'none');
check('thấp hơn minimum → required', evaluatePolicy('1.0.0', { ...DEFAULT_POLICY, minimumVersion: '1.2.0' }).level === 'required');
check('bằng minimum → không required', evaluatePolicy('1.2.0', { ...DEFAULT_POLICY, minimumVersion: '1.2.0' }).level === 'none');
check('cao hơn minimum, thấp hơn recommended → recommended', evaluatePolicy('1.2.0', { ...DEFAULT_POLICY, minimumVersion: '1.2.0', recommendedVersion: '1.3.0' }).level === 'recommended');
check('bằng recommended → none', evaluatePolicy('1.3.0', { ...DEFAULT_POLICY, minimumVersion: '1.2.0', recommendedVersion: '1.3.0' }).level === 'none');
check('cao hơn tất cả → none', evaluatePolicy('2.0.0', { ...DEFAULT_POLICY, minimumVersion: '1.2.0', recommendedVersion: '1.3.0' }).level === 'none');
check('prerelease dưới minimum → required', evaluatePolicy('1.2.0-beta', { ...DEFAULT_POLICY, minimumVersion: '1.2.0' }).level === 'required');
check('required ưu tiên hơn recommended', evaluatePolicy('1.0.0', { ...DEFAULT_POLICY, minimumVersion: '1.5.0', recommendedVersion: '1.1.0' }).level === 'required');
check('có reason mô tả', evaluatePolicy('1.0.0', { ...DEFAULT_POLICY, minimumVersion: '1.5.0' }).reason.includes('1.5.0'));

console.log('— khớp electron-builder.json (chống lệch cấu hình) —');
{
  const cfgPath = path.join(process.cwd(), 'electron-builder.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  check('GITHUB_OWNER khớp publish.owner', cfg.publish.owner === GITHUB_OWNER, { config: cfg.publish.owner, code: GITHUB_OWNER });
  check('GITHUB_REPO khớp publish.repo', cfg.publish.repo === GITHUB_REPO, { config: cfg.publish.repo, code: GITHUB_REPO });
  check('publish.releaseType = release (không phải draft)', cfg.publish.releaseType === 'release', cfg.publish.releaseType);
  check('POLICY_URL đúng dạng URL tải asset ổn định',
    POLICY_URL === `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest/download/${POLICY_ASSET_NAME}`, POLICY_URL);
}

console.log('— file policy trong repo —');
{
  const p = path.join(process.cwd(), POLICY_ASSET_NAME);
  const exists = fs.existsSync(p);
  check(`${POLICY_ASSET_NAME} tồn tại ở gốc repo (CI upload làm asset)`, exists);
  if (exists) {
    const parsed = parsePolicy(JSON.parse(fs.readFileSync(p, 'utf8')));
    check('file policy hợp lệ theo parsePolicy', parsed !== null, parsed);
    check('policy hiện tại không ép ai (minimum 0.0.0)', parsed?.minimumVersion === '0.0.0', parsed);
  }
}

console.log(fail === 0 ? '\n✓ UPDATE POLICY PASSED' : `\n✗ UPDATE POLICY FAILED (${fail})`);
process.exit(fail === 0 ? 0 : 1);
