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
console.log('[Build] Static assets copied successfully.');
