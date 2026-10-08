// Builds the static site (for GitHub Pages) from the Apps Script page: node web/build.mjs [out dir, default _site]
//
// src/Index.html is an Apps Script template. Here its include()s are filled in with the other src/*.html files, the
// item to open comes from ?item= on the address instead of from the server, and the head gets what Code.gs's
// doGet adds there (title and viewport) plus web/config.js and web/api.js, which stand in for google.script.run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(root, process.argv[2] || '_site');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

let html = read('src', 'Index.html');
html = html.replace(/<\?!= include\('(\w+)'\); \?>/g, (_, name) => read('src', name + '.html'));
html = html.replace('<?!= JSON.stringify(itemId) ?>', "(new URLSearchParams(location.search).get('item') || '').trim().toUpperCase()");
html = html.replace('<meta charset="utf-8">', `<meta charset="utf-8">
<title>Lab Inventory</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Inventory">
<script src="config.js"></script>
<script src="api.js"></script>`);
const left = html.match(/<\?[\s\S]*?\?>/);
if (left) throw new Error('Apps Script template code left in the page: ' + left[0]);
if (!html.includes('<script src="api.js">')) throw new Error('Could not add the scripts to the head');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), html);
for (const f of ['config.js', 'api.js']) fs.copyFileSync(path.join(root, 'web', f), path.join(out, f));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`Built ${path.relative(root, out) || '.'}/index.html (${(html.length / 1024).toFixed(0)} KB)`);
