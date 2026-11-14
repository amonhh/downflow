import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const HOST_NAME = 'com.downflow.helper';
export const HOST_VERSION = '1.0.0';

export function downflowRoot() {
  if (process.env.DOWNFLOW_DATA_DIR) return resolve(process.env.DOWNFLOW_DATA_DIR);
  if (platform() === 'win32' && process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, 'DownFlow');
  return join(homedir(), '.downflow');
}

export function nativeRoot() {
  return join(downflowRoot(), 'native');
}

export function toolsRoot() {
  return join(downflowRoot(), 'bin');
}

export function jobsRoot() {
  return join(downflowRoot(), 'jobs');
}

export function downloadsRoot() {
  if (process.env.DOWNFLOW_OUTPUT_DIR) return resolve(process.env.DOWNFLOW_OUTPUT_DIR);
  if (platform() === 'win32') return join(homedir(), 'Downloads', 'DownFlow');
  return join(homedir(), 'Downloads', 'DownFlow');
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

function firstExisting(paths) {
  for (const path of paths) {
    if (path && existsSync(path)) return path;
  }
  return undefined;
}

function which(name) {
  try {
    const result = spawnSync(platform() === 'win32' ? 'where.exe' : 'which', [name], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    if (result.status === 0) {
      const line = (result.stdout || '').split(/\r?\n/).map((value) => value.trim()).find(Boolean);
      return line || undefined;
    }
  } catch {
    // Fall through to the explicit candidates.
  }
  return undefined;
}

export function findYtDlp() {
  const binary = platform() === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  return firstExisting([
    process.env.DOWNFLOW_YTDLP,
    join(toolsRoot(), binary),
    join(nativeRoot(), 'bin', binary),
    which(platform() === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'),
    which('yt-dlp'),
  ]);
}

export function findFfmpeg() {
  const binary = platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  return firstExisting([
    process.env.DOWNFLOW_FFMPEG,
    join(toolsRoot(), binary),
    join(nativeRoot(), 'bin', binary),
    which(platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
    which('ffmpeg'),
  ]);
}

function versionOf(command, args) {
  try {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15_000,
    });
    const text = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    if (result.status !== 0 && !text) return undefined;
    return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  } catch {
    return undefined;
  }
}

export function helperStatus() {
  const ytDlpPath = findYtDlp();
  const ffmpegPath = findFfmpeg();
  const ytDlpVersion = ytDlpPath ? versionOf(ytDlpPath, ['--version']) : undefined;
  const ffmpegVersion = ffmpegPath ? versionOf(ffmpegPath, ['-version']) : undefined;

  return {
    available: true,
    hostVersion: HOST_VERSION,
    platform: `${platform()} ${process.arch}`,
    ytDlp: {
      available: Boolean(ytDlpPath) && Boolean(ytDlpVersion),
      path: ytDlpPath,
      version: ytDlpVersion,
    },
    ffmpeg: {
      available: Boolean(ffmpegPath) && Boolean(ffmpegVersion),
      path: ffmpegPath,
      version: ffmpegVersion ? ffmpegVersion.replace(/^ffmpeg version\s+/i, '').split(/\s+/)[0] : undefined,
    },
    outputDir: downloadsRoot(),
    jobsDir: jobsRoot(),
  };
}

export function sanitizeStem(value) {
  const cleaned = String(value || '')
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 150)
    .trim();
  return cleaned || 'downflow-video';
}

export function jobPath(id) {
  return join(jobsRoot(), `${id}.json`);
}

export function readJob(id) {
  const path = jobPath(id);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

export function writeJob(id, state) {
  ensureDir(jobsRoot());
  const path = jobPath(id);
  const temp = join(tmpdir(), `downflow-job-${id}-${Date.now()}.json`);
  writeFileSync(temp, JSON.stringify({ ...state, updatedAt: Date.now() }, null, 2), 'utf8');
  try {
    renameSync(temp, path);
  } catch {
    writeFileSync(path, JSON.stringify({ ...state, updatedAt: Date.now() }, null, 2), 'utf8');
    rmSync(temp, { force: true });
  }
  return path;
}

export function removeJob(id) {
  try {
    rmSync(jobPath(id), { force: true });
  } catch {
    // Job record cleanup is best effort.
  }
}

export function killProcessTree(pid) {
  if (!pid || !Number.isFinite(pid)) return;
  try {
    if (platform() === 'win32') {
      spawnSync('taskkill.exe', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // The process already exited.
    }
  }
}

function launch(command, args, failureMessage) {
  const result = spawnSync(command, args, { windowsHide: true, timeout: 10_000, stdio: 'ignore' });
  // Launchers such as explorer.exe routinely exit with a nonzero code (and can
  // outlive the 10s timeout) even when the window opened correctly. Only a real
  // spawn failure, such as ENOENT or EACCES, means the action did not happen.
  if (result.error && result.error.code !== 'ETIMEDOUT') {
    throw new Error(`${failureMessage} ${result.error.message}`);
  }
  return '';
}

function requireFile(path, action) {
  if (!path) throw new Error(`There is no file path to ${action}.`);
  if (!existsSync(path)) throw new Error(`The file is no longer at ${path}`);
}

export function openPath(path) {
  requireFile(path, 'open');
  if (platform() === 'win32') {
    // The empty title argument keeps `start` from treating the quoted path as one.
    return launch('cmd.exe', ['/d', '/s', '/c', 'start', '""', path], 'Windows could not open the file.');
  }
  const command = platform() === 'darwin' ? 'open' : 'xdg-open';
  return launch(command, [path], `Could not open the file with ${command}.`);
}

export function revealPath(path) {
  requireFile(path, 'reveal');
  if (platform() === 'win32') {
    // `/select,<path>` must be one argument so Explorer selects the file rather
    // than interpreting a path with spaces as extra switches.
    return launch('explorer.exe', [`/select,${path}`], 'Windows Explorer could not show the file.');
  }
  const folder = dirname(path);
  const command = platform() === 'darwin' ? 'open' : 'xdg-open';
  return launch(command, [folder], `Could not open the folder with ${command}.`);
}

export function stripProbe(raw, url) {
  const entries = Array.isArray(raw?.entries) ? raw.entries : undefined;
  const primary = raw && raw._type === 'playlist' && entries?.length ? entries[0] : raw;
  const formats = Array.isArray(primary?.formats) ? primary.formats : [];
  const useful = formats
    .filter((format) => format && format.format_id && format.ext !== 'mhtml')
    .map((format) => ({
      format_id: format.format_id,
      format_note: format.format_note,
      ext: format.ext,
      protocol: format.protocol,
      width: format.width,
      height: format.height,
      fps: format.fps,
      vcodec: format.vcodec,
      acodec: format.acodec,
      resolution: format.resolution,
      filesize: format.filesize,
      filesize_approx: format.filesize_approx,
      tbr: format.tbr,
      abr: format.abr,
      vbr: format.vbr,
      audio_ext: format.audio_ext,
      video_ext: format.video_ext,
      has_drm: format.has_drm,
      language: format.language,
    }));

  return {
    id: primary?.id,
    title: primary?.title,
    uploader: primary?.uploader || primary?.channel,
    channel: primary?.channel,
    duration: primary?.duration,
    thumbnail: primary?.thumbnail,
    extractor_key: primary?.extractor_key,
    extractor: primary?.extractor,
    webpage_url: primary?.webpage_url || url,
    is_live: Boolean(primary?.is_live),
    _type: primary?._type || raw?._type,
    formats: useful,
  };
}
