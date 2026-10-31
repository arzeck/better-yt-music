/**
 * Generate icons as PNG files using canvas.
 * Run with Node.js: node generate-icons.js
 * Requires: npm install canvas
 *
 * Or just run this script — it uses the built-in canvas via Node Canvas API.
 * For a simple approach without dependencies, we generate SVG-encoded PNGs.
 */

const fs = require('fs');
const path = require('path');

// We'll create simple SVG-based PNGs using the PNG format directly
// Since we don't want npm dependencies, we'll create minimal valid PNGs

// Create SVG for each size
function createIconSVG(size) {
  const pad = Math.round(size * 0.12);
  const r   = Math.round(size * 0.22);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1c1c2e"/>
      <stop offset="100%" style="stop-color:#0f0f1a"/>
    </linearGradient>
    <linearGradient id="icon" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#ff6b9d"/>
      <stop offset="100%" style="stop-color:#c44dff"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${r}" fill="url(#bg)"/>
  <text x="${size/2}" y="${size * 0.68}" 
        font-family="system-ui" font-size="${Math.round(size * 0.55)}" 
        fill="url(#icon)" text-anchor="middle" font-weight="bold">♪</text>
</svg>`;
}

const sizes = [16, 48, 128];
const iconsDir = path.join(__dirname, 'icons');

if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

for (const size of sizes) {
  const svg = createIconSVG(size);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.svg`), svg);
  console.log(`Created icon${size}.svg`);
}

console.log('\nSVG icons created. Chrome extensions accept PNG — convert with:');
console.log('  npm install -g svgexport');
console.log('  svgexport icons/icon16.svg icons/icon16.png');
console.log('\nOr load the extension without icons for testing.');
