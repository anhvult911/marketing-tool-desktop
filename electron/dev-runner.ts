import { spawn } from 'child_process';
import http from 'http';

function checkNextDevReady(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:3000', (res) => {
      resolve(res.statusCode !== undefined);
    });
    req.on('error', () => {
      resolve(false);
    });
  });
}

async function start() {
  console.log('⏳ Waiting for Next.js dev server at http://localhost:3000...');
  let ready = false;
  while (!ready) {
    ready = await checkNextDevReady();
    if (!ready) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  console.log('🚀 Next.js is ready! Building electron & worker files...');
  const { execSync } = require('child_process');
  try {
    execSync('npm run build:electron && npm run build:worker', { stdio: 'inherit' });
  } catch (err: any) {
    console.warn('[Dev-Runner] Build warning:', err.message);
  }

  console.log('🚀 Launching Electron Desktop App...');
  const electronProcess = spawn('npx', ['electron', '.'], {
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' }
  });

  electronProcess.on('close', (code) => {
    process.exit(code || 0);
  });
}

start();
