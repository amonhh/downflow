import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { HOST_NAME, helperStatus } from '../native/lib.mjs';

const status = helperStatus();
const registrations = [
  ['Chrome', `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`],
  ['Edge', `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`],
  ['Brave', `HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${HOST_NAME}`],
];

const registered = registrations.map(([name, key]) => {
  const result = spawnSync('reg.exe', ['query', key, '/ve'], { encoding: 'utf8', windowsHide: true });
  return { name, key, registered: result.status === 0 };
});

console.log('DownFlow native helper status');
console.log(`  Host version : ${status.hostVersion}`);
console.log(`  Platform     : ${status.platform}`);
console.log(`  Output folder: ${status.outputDir}`);
console.log(`  Jobs folder  : ${status.jobsDir}`);
console.log(`  yt-dlp       : ${status.ytDlp.available ? `${status.ytDlp.version} (${status.ytDlp.path})` : 'NOT FOUND'}`);
console.log(`  FFmpeg       : ${status.ffmpeg.available ? `${status.ffmpeg.version} (${status.ffmpeg.path})` : 'NOT FOUND'}`);
console.log('');
for (const entry of registered) {
  console.log(`  ${entry.name.padEnd(7)}: ${entry.registered ? 'registered' : 'not registered'}`);
}
const manifest = join(status.jobsDir, '..', `${HOST_NAME}.json`);
console.log(`  Manifest     : ${manifest}`);
