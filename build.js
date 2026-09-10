const fs = require('node:fs');
fs.mkdirSync('public', {recursive: true});
// Explicit allowlist: only Firebase-connected pages are published.
if (fs.existsSync('public/foundation.html')) fs.unlinkSync('public/foundation.html');
for (const file of ['index.html', 'dashboard.html', 'clock.html', 'driver.html', 'payroll.html', 'stock.html', 'manifest.json', 'admin.html', 'admin.js', 'easy-page.js', 'firebase-client.js', 'icon-192.png', 'icon-512.png']) fs.copyFileSync(file, `public/${file}`);
