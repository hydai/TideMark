// Simple icon generator for the extension
// This creates placeholder PNG icons from SVG

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const svgTemplate = (size) => `
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="url(#grad)"/>
  <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="${size * 0.5}" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="central">T</text>
</svg>
`;

const sizes = [16, 48, 128];
const iconsDir = path.join(__dirname, 'public', 'icons');

// Ensure directory exists
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Write SVG files (Chrome can use SVG icons)
sizes.forEach(size => {
  const svg = svgTemplate(size);
  const filename = path.join(iconsDir, `icon${size}.svg`);
  fs.writeFileSync(filename, svg);
  console.log(`Created ${filename}`);
});

// For PNG support, we'll create a simple colored square as fallback
// In production, you'd use a proper SVG to PNG converter
const createPNGPlaceholder = (size) => {
  // This is a placeholder - in real production you'd use sharp or canvas
  // For now, we'll just copy the SVG and rename it
  const svg = svgTemplate(size);
  return svg;
};

sizes.forEach(size => {
  const svg = svgTemplate(size);
  const filename = path.join(iconsDir, `icon${size}.png.svg`);
  fs.writeFileSync(filename, svg);

  // Also create a proper named file
  const properFilename = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(properFilename, svg);
  console.log(`Created placeholder for ${properFilename}`);
});

console.log('Icon generation complete!');
console.log('Note: For production, replace these with proper PNG files');
