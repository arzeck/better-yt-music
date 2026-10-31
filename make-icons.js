const fs = require('fs');

function makeSVG(size) {
  const r = Math.round(size * 0.22);
  const fontSize = Math.round(size * 0.55);
  const cy = Math.round(size * 0.68);
  const cx = Math.round(size / 2);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">',
    '  <defs>',
    '    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">',
    '      <stop offset="0%" stop-color="#1c1c2e"/>',
    '      <stop offset="100%" stop-color="#0f0f1a"/>',
    '    </linearGradient>',
    '    <linearGradient id="ic" x1="0%" y1="0%" x2="100%" y2="100%">',
    '      <stop offset="0%" stop-color="#ff6b9d"/>',
    '      <stop offset="100%" stop-color="#c44dff"/>',
    '    </linearGradient>',
    '  </defs>',
    '  <rect width="' + size + '" height="' + size + '" rx="' + r + '" fill="url(#bg)"/>',
    '  <text x="' + cx + '" y="' + cy + '" font-family="sans-serif" font-size="' + fontSize + '" fill="url(#ic)" text-anchor="middle" font-weight="bold">&#x266B;</text>',
    '</svg>'
  ];
  return lines.join('\n');
}

[16, 48, 128].forEach(function(s) {
  fs.writeFileSync('icons/icon' + s + '.svg', makeSVG(s));
  console.log('Created icon' + s + '.svg');
});
