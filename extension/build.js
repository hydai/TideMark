import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Copy manifest and HTML files to dist
const filesToCopy = [
  'manifest.json',
  'popup.html',
  'popup.css'
];

const distDir = path.join(__dirname, 'dist');

// Create dist directory if it doesn't exist
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy files
filesToCopy.forEach(file => {
  const src = path.join(__dirname, file);
  const dest = path.join(distDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Copied ${file}`);
  }
});

// Copy public directory (icons, etc.)
const publicDir = path.join(__dirname, 'public');
const distPublicDir = path.join(distDir);

if (fs.existsSync(publicDir)) {
  fs.cpSync(publicDir, distPublicDir, { recursive: true });
  console.log('Copied public assets');
}

console.log('Build complete!');
