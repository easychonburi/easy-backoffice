const fs = require('node:fs');
fs.mkdirSync('public', {recursive: true});
// Explicit allowlist: only Firebase-connected pages are published.
if (fs.existsSync('public/foundation.html')) fs.unlinkSync('public/foundation.html');
for (const file of ['index.html', 'dashboard.html', 'clock.html', 'driver.html', 'payroll.html', 'stock.html', 'manifest.json', 'admin.html', 'admin.js', 'data.html', 'data.js', 'easy-page.js', 'firebase-client.js', 'icon-192.png', 'icon-512.png']) fs.copyFileSync(file, `public/${file}`);

fs.copyFileSync('functions/payroll-core.js', 'public/payroll-core.js');
for (const file of ['employee.js','employee.css','employee-admin.js','profile.js']) fs.copyFileSync(file, 'public/'+file);
// Keep the deployed source identifiable without exposing any credentials.
const {execFileSync} = require('node:child_process');
const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim();
fs.writeFileSync('public/deployment.json', JSON.stringify({
  repository: 'easychonburi/easy-backoffice',
  branch: git('branch', '--show-current'),
  commit: git('rev-parse', 'HEAD'),
  sourceDirty: Boolean(git('status', '--porcelain')),
  builtAt: new Date().toISOString()
}, null, 2) + '\n');
