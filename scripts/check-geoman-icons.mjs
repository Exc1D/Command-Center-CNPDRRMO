import fs from 'node:fs';
import path from 'node:path';

const icons = ['polyline', 'polygon', 'rectangle', 'edit', 'drag', 'rotate'];
const assets = path.resolve('dist/assets');
const css = fs.readdirSync(assets)
  .filter(file => file.endsWith('.css'))
  .map(file => fs.readFileSync(path.join(assets, file), 'utf8'))
  .join('\n');
const missing = icons.filter(icon => !css.includes(`.leaflet-pm-icon-${icon}`));
const brokenMasks = css.match(/mask="url\('%23/g) ?? [];

if (missing.length || brokenMasks.length) {
  throw new Error(`Broken Geoman icons: ${missing.join(', ') || `${brokenMasks.length} invalid SVG masks`}`);
}
console.log(`Verified ${icons.length} Geoman icons`);
