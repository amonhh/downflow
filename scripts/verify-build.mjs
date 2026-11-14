import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), 'dist');
const required = [
  'manifest.json',
  'popup.html',
  'dashboard.html',
  'options.html',
  'offscreen.html',
  'content.js',
  'background/service-worker.js',
  'icons/icon-16.png',
  'icons/icon-32.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
];

let failed = false;
for (const file of required) {
  const path = resolve(root, file);
  if (!existsSync(path)) {
    console.error(`MISSING: ${file}`);
    failed = true;
  } else {
    const size = statSync(path).size;
    console.log(`ok  ${file.padEnd(36)} ${size.toLocaleString()} bytes`);
  }
}

if (existsSync(resolve(root, 'manifest.json'))) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
  if (manifest.manifest_version !== 3) {
    console.error('manifest.json is not Manifest V3');
    failed = true;
  }
  if (!/background\/service-worker\.js/.test(manifest.background?.service_worker ?? '')) {
    console.error('Background service worker path is invalid');
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
console.log('\nDownFlow build verification passed.');
