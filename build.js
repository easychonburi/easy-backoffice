const fs = require('node:fs');
fs.mkdirSync('public', {recursive: true});
// Explicit allowlist: never publish legacy pages that still call the production Apps Script.
for (const file of ['index.html', 'foundation.html', 'admin.html', 'admin.js', 'firebase-client.js', 'icon-192.png', 'icon-512.png']) fs.copyFileSync(file, `public/${file}`);
