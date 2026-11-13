const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '_wasmer');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(path.join(output, 'assets'), { recursive: true });
for (const file of ['package.json', 'package-lock.json', 'server.js', 'backend.js', 'storage.js', 'auth-storage.js', 'verification.js', 'index.html', 'home.html', 'login.html', 'create.html', 'app.js', 'account.js', 'create.js', 'config.js', 'styles.css', 'assets/cc.webp', 'assets/slap.webp']) {
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}
execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--prefix', output], { stdio: 'inherit' });
