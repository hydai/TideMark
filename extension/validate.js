// Extension validation script
// Checks for common issues before loading in Chrome

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');

let errors = 0;
let warnings = 0;

function error(msg) {
  console.error(`❌ ERROR: ${msg}`);
  errors++;
}

function warn(msg) {
  console.warn(`⚠️  WARNING: ${msg}`);
  warnings++;
}

function success(msg) {
  console.log(`✅ ${msg}`);
}

// Check dist directory exists
if (!fs.existsSync(distDir)) {
  error('dist/ directory not found. Run "npm run build" first.');
  process.exit(1);
}

// Check manifest.json
const manifestPath = path.join(distDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  error('manifest.json not found in dist/');
} else {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // Check manifest version
  if (manifest.manifest_version !== 3) {
    error('manifest_version must be 3');
  } else {
    success('Manifest v3 confirmed');
  }

  // Check required fields
  if (!manifest.name) error('manifest.json missing "name"');
  if (!manifest.version) error('manifest.json missing "version"');
  if (!manifest.description) warn('manifest.json missing "description"');

  // Check permissions
  const requiredPerms = ['storage', 'activeTab', 'scripting'];
  requiredPerms.forEach(perm => {
    if (!manifest.permissions?.includes(perm)) {
      error(`Missing permission: ${perm}`);
    }
  });
  success('All required permissions present');

  // Check content scripts
  const contentScripts = manifest.content_scripts || [];
  const expectedScripts = ['content/youtube.js', 'content/twitch.js'];

  expectedScripts.forEach(script => {
    const found = contentScripts.some(cs => cs.js?.includes(script));
    if (!found) {
      error(`Content script not found in manifest: ${script}`);
    } else {
      // Check file exists
      const scriptPath = path.join(distDir, script);
      if (!fs.existsSync(scriptPath)) {
        error(`Content script file not found: ${script}`);
      } else {
        success(`Content script found: ${script}`);
      }
    }
  });

  // Check background service worker
  if (!manifest.background?.service_worker) {
    error('manifest.json missing background.service_worker');
  } else {
    const bgPath = path.join(distDir, manifest.background.service_worker);
    if (!fs.existsSync(bgPath)) {
      error(`Background service worker not found: ${manifest.background.service_worker}`);
    } else {
      success('Background service worker found');
    }
  }

  // Check popup
  if (!manifest.action?.default_popup) {
    error('manifest.json missing action.default_popup');
  } else {
    const popupPath = path.join(distDir, manifest.action.default_popup);
    if (!fs.existsSync(popupPath)) {
      error(`Popup HTML not found: ${manifest.action.default_popup}`);
    } else {
      success('Popup HTML found');
    }
  }

  // Check icons
  const icons = manifest.icons || {};
  Object.entries(icons).forEach(([size, iconPath]) => {
    const fullPath = path.join(distDir, iconPath);
    if (!fs.existsSync(fullPath)) {
      warn(`Icon not found: ${iconPath} (size ${size})`);
    }
  });

  if (Object.keys(icons).length > 0) {
    success('Icons configured');
  }
}

// Check popup.css
const popupCssPath = path.join(distDir, 'popup.css');
if (!fs.existsSync(popupCssPath)) {
  error('popup.css not found in dist/');
} else {
  success('popup.css found');
}

// Check popup.js
const popupJsPath = path.join(distDir, 'popup', 'popup.js');
if (!fs.existsSync(popupJsPath)) {
  error('popup/popup.js not found in dist/');
} else {
  success('popup/popup.js found');
}

// Summary
console.log('\n' + '='.repeat(50));
if (errors === 0 && warnings === 0) {
  console.log('✨ All checks passed! Extension is ready to load.');
  console.log('\nTo install:');
  console.log('1. Open Chrome and go to chrome://extensions/');
  console.log('2. Enable "Developer mode" (top right)');
  console.log('3. Click "Load unpacked"');
  console.log(`4. Select: ${distDir}`);
} else {
  console.log(`\n${errors} error(s), ${warnings} warning(s)`);
  if (errors > 0) {
    console.log('❌ Fix errors before loading extension');
    process.exit(1);
  }
}
