import { existsSync, rmSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { HOST_NAME } from '../native/lib.mjs';

if (platform() !== 'win32') {
  console.error('The DownFlow native helper uninstaller currently supports Windows only.');
  process.exit(1);
}

const root = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'DownFlow') : join(homedir(), '.downflow');
const purge = process.argv.includes('--purge');
const registrations = [
  `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
  `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`,
  `HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${HOST_NAME}`,
  `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`,
  `HKCU\\Software\\Vivaldi\\NativeMessagingHosts\\${HOST_NAME}`,
];

for (const key of registrations) {
  spawnSync('reg.exe', ['delete', key, '/f'], { windowsHide: true });
}

const manifest = join(root, `${HOST_NAME}.json`);
if (existsSync(manifest)) rmSync(manifest, { force: true });
rmSync(join(root, 'native'), { recursive: true, force: true });

if (purge) {
  rmSync(root, { recursive: true, force: true });
  console.log('Removed the DownFlow helper, jobs and bundled tools. Downloaded videos were not deleted.');
} else {
  console.log('Removed the DownFlow native helper registration and host files.');
  console.log('Downloaded videos and job history were kept. Use --purge to remove helper data too.');
}
