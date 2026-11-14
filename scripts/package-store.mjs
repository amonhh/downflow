#!/usr/bin/env node
/**
 * Builds the Chrome Web Store upload archive from dist/.
 *
 * The archive contains the contents of dist/ at its root, which is what the
 * Web Store expects. Run `npm run build` first (or use `npm run package:store`).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve('.');
const dist = join(root, 'dist');
const manifestPath = join(dist, 'manifest.json');

if (!existsSync(manifestPath)) {
  console.error('dist/manifest.json is missing. Run `npm run build` first.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.manifest_version !== 3) {
  console.error('Refusing to package: manifest_version must be 3.');
  process.exit(1);
}
if (!manifest.name || !manifest.version || !manifest.description) {
  console.error('Refusing to package: name, version and description are required.');
  process.exit(1);
}

const required = [
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
const missing = required.filter((file) => !existsSync(join(dist, file)));
if (missing.length) {
  console.error(`Refusing to package; missing: ${missing.join(', ')}`);
  process.exit(1);
}

const releaseDir = join(root, 'release');
mkdirSync(releaseDir, { recursive: true });
const zipPath = join(releaseDir, `downflow-${manifest.version}-chrome.zip`);
rmSync(zipPath, { force: true });

function zipWithPowerShell() {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$source = (Resolve-Path -LiteralPath $env:DOWNFLOW_ZIP_SOURCE).Path
$zip = [System.IO.Compression.ZipFile]::Open($env:DOWNFLOW_ZIP_DEST, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -LiteralPath $source -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($source.Length + 1).Replace('\\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zip, $_.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $zip.Dispose()
}
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, DOWNFLOW_ZIP_SOURCE: dist, DOWNFLOW_ZIP_DEST: zipPath },
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error('PowerShell could not create the ZIP archive.');
}

function zipWithUnixZip() {
  const result = spawnSync('zip', ['-r', '-X', '-q', zipPath, '.'], { cwd: dist, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error('The `zip` command could not create the archive.');
}

try {
  if (process.platform === 'win32') zipWithPowerShell();
  else zipWithUnixZip();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const size = statSync(zipPath).size;
console.log(`\nChrome Web Store package ready: ${zipPath}`);
console.log(`Version ${manifest.version} — ${(size / 1024).toFixed(1)} KiB`);
console.log('Upload this ZIP itself; do not upload the dist folder or a ZIP of the folder.');
