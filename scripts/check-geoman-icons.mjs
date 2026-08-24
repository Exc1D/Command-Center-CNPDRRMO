import fs from 'node:fs';
import path from 'node:path';

const icons = ['polyline', 'polygon', 'rectangle', 'edit', 'drag', 'rotate'];
const assets = path.resolve('dist/assets');
const css = fs.readdirSync(assets)
  .filter(file => file.endsWith('.css'))
  .map(file => fs.readFileSync(path.join(assets, file), 'utf8'))
  .join('\n');
const missing = icons.filter(icon => !new RegExp(`\\.leaflet-pm-icon-${icon}\\{background-image:url\\([^)]*%3Csvg`).test(css));

if (missing.length) throw new Error(`Broken Geoman icons: ${missing.join(', ')}`);
console.log(`Verified ${icons.length} Geoman icons`);
