import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HOST_NAME, downloadsRoot, helperStatus, toolsRoot } from '../native/lib.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const match = args.find((arg) => arg.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : undefined;
};

if (platform() !== 'win32') {
  console.error('The DownFlow native helper installer currently supports Windows only.');
  process.exit(1);
}

function extensionIdForPath(path) {
  const normalized = resolve(path);
  const digest = createHash('sha256').update(Buffer.from(normalized, 'utf16le')).digest('hex').slice(0, 32);
  return digest.replace(/[0-9a-f]/g, (character) => String.fromCharCode(97 + parseInt(character, 16)));
}

function dataRoot() {
  return process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'DownFlow') : join(homedir(), '.downflow');
}

function runReg(key, manifestPath) {
  const result = spawnSync('reg.exe', ['add', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`Could not register ${key}: ${(result.stderr || result.stdout || '').trim()}`);
  }
}

async function downloadYtDlp() {
  const binDir = toolsRoot();
  mkdirSync(binDir, { recursive: true });
  const target = join(binDir, 'yt-dlp.exe');
  const release = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
  console.log('Downloading yt-dlp from the official GitHub release…');
  const response = await fetch(`${release}/yt-dlp.exe`, { redirect: 'follow' });
  if (!response.ok) throw new Error(`yt-dlp download failed with HTTP ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  let expected = '';
  try {
    const sums = await fetch(`${release}/SHA2-256SUMS`, { redirect: 'follow' });
    if (sums.ok) {
      const line = (await sums.text()).split(/\r?\n/).find((entry) => entry.trim().endsWith('yt-dlp.exe'));
      expected = line?.trim().split(/\s+/)[0] ?? '';
    }
  } catch {
    // The checksum is optional; the release still comes from the official repository.
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (expected && expected.toLowerCase() !== actual) {
    throw new Error('The downloaded yt-dlp.exe did not match the published SHA-256 checksum.');
  }
  writeFileSync(target, bytes);
  console.log(`Installed yt-dlp: ${target}`);
  if (!expected) console.log('Warning: the release checksum could not be verified. Review the download before using it.');
  return target;
}

async function downloadFfmpeg() {
  const binDir = toolsRoot();
  mkdirSync(binDir, { recursive: true });
  const target = join(binDir, 'ffmpeg.exe');
  const url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
  console.log('Downloading the FFmpeg essentials build from gyan.dev…');
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`FFmpeg download failed with HTTP ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  let expected = '';
  try {
    const sums = await fetch(`${url}.sha256`, { redirect: 'follow' });
    if (sums.ok) expected = (await sums.text()).trim().split(/\s+/)[0] ?? '';
  } catch {
    // The checksum is optional; the release still comes from the official site.
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (expected && expected.toLowerCase() !== actual) {
    throw new Error('The downloaded FFmpeg archive did not match the published SHA-256 checksum.');
  }
  const stamp = Date.now();
  const zipPath = join(tmpdir(), `downflow-ffmpeg-${stamp}.zip`);
  const extractDir = join(tmpdir(), `downflow-ffmpeg-${stamp}`);
  writeFileSync(zipPath, bytes);
  mkdirSync(extractDir, { recursive: true });
  try {
    let extracted = spawnSync('tar.exe', ['-xf', zipPath, '-C', extractDir], {
      windowsHide: true,
      encoding: 'utf8',
    });
    if (extracted.error || extracted.status !== 0) {
      const quote = (value) => `'${value.replace(/'/g, "''")}'`;
      extracted = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -LiteralPath ${quote(zipPath)} -DestinationPath ${quote(extractDir)} -Force`,
        ],
        { windowsHide: true, encoding: 'utf8' },
      );
    }
    if (extracted.status !== 0) {
      throw new Error(
        `Could not extract the FFmpeg archive: ${(extracted.stderr || extracted.stdout || '').trim() || 'extraction failed'}`,
      );
    }
    const found = findFile(extractDir, 'ffmpeg.exe');
    if (!found) throw new Error('The FFmpeg archive did not contain ffmpeg.exe.');
    copyFileSync(found, target);
  } finally {
    rmSync(zipPath, { force: true });
    rmSync(extractDir, { recursive: true, force: true });
  }
  console.log(`Installed FFmpeg: ${target}`);
  if (!expected) console.log('Warning: the archive checksum could not be verified. Review the download before using it.');
  return target;
}

function findFile(root, name) {
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      const found = findFile(path, name);
      if (found) return found;
    } else if (entry.toLowerCase() === name) {
      return path;
    }
  }
  return undefined;
}

async function main() {
  const distPath = resolve(value('--path') || join(repoRoot, 'dist'));
  const extensionId = value('--extension-id') || extensionIdForPath(distPath);
  if (!/^[a-p]{32}$/.test(extensionId)) {
    throw new Error(`The extension id "${extensionId}" is not a valid Chrome extension id.`);
  }

  const root = dataRoot();
  const nativeDir = join(root, 'native');
  try {
    rmSync(nativeDir, { recursive: true, force: true });
  } catch {
    // Windows can refuse to remove the folder while a helper process is loaded;
    // overwriting the files in place below is still safe.
  }
  mkdirSync(nativeDir, { recursive: true });

  for (const file of ['lib.mjs', 'host.mjs', 'download-job.mjs']) {
    const source = join(repoRoot, 'native', file);
    if (!existsSync(source)) throw new Error(`Missing helper file: ${source}`);
    writeFileSync(join(nativeDir, file), readFileSync(source));
  }

  const hostCmd = join(nativeDir, 'host.cmd');
  writeFileSync(
    hostCmd,
    `@echo off\r\n"${process.execPath}" "%~dp0host.mjs" %*\r\n`,
    'utf8',
  );

  const manifestPath = join(root, `${HOST_NAME}.json`);
  const manifest = {
    name: HOST_NAME,
    description: 'DownFlow optional video-site download helper (yt-dlp)',
    path: hostCmd,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const registrations = [
    `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
    `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`,
    `HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${HOST_NAME}`,
    `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`,
    `HKCU\\Software\\Vivaldi\\NativeMessagingHosts\\${HOST_NAME}`,
  ];
  for (const key of registrations) runReg(key, manifestPath);

  mkdirSync(downloadsRoot(), { recursive: true });

  if (flag('--download-ytdlp')) {
    await downloadYtDlp();
  }
  if (flag('--download-ffmpeg')) {
    await downloadFfmpeg();
  }

  const status = helperStatus();
  console.log('');
  console.log('DownFlow native helper installed.');
  console.log(`  Extension id : ${extensionId}`);
  console.log(`  Host manifest: ${manifestPath}`);
  console.log(`  Host command : ${hostCmd}`);
  console.log(`  Output folder: ${status.outputDir}`);
  console.log(`  yt-dlp       : ${status.ytDlp.available ? status.ytDlp.version : 'NOT INSTALLED'}`);
  console.log(`  FFmpeg       : ${status.ffmpeg.available ? status.ffmpeg.version : 'NOT INSTALLED'}`);
  console.log('');
  if (!status.ytDlp.available) {
    console.log('To enable site downloads, install yt-dlp or run:');
    console.log('  npm run native:install -- --download-ytdlp');
  }
  if (!status.ffmpeg.available) {
    console.log('For separate high-quality video/audio streams, install FFmpeg with:');
    console.log('  npm run native:install -- --download-ffmpeg');
    console.log('  (or add ffmpeg.exe to PATH; official builds: https://www.gyan.dev/ffmpeg/builds/)');
  }
  console.log('Reload the DownFlow extension in chrome://extensions, then open Settings → Video sites.');
  console.log('Only download media you have permission to save. DownFlow does not bypass DRM or paywalls.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
