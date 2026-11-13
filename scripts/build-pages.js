const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const out = path.join(root, '_site');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js', 'assets/cc.webp', 'assets/slap.webp']) {
  fs.copyFileSync(path.join(root, file), path.join(out, file));
}
