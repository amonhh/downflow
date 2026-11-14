import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  downloadsRoot,
  ensureDir,
  findFfmpeg,
  findYtDlp,
  jobPath,
  sanitizeStem,
  writeJob,
} from './lib.mjs';

const jobFile = process.argv[2];
if (!jobFile) {
  process.stderr.write('DownFlow download job: missing job file\n');
  process.exit(2);
}

let job;
try {
  job = JSON.parse(readFileSync(jobFile, 'utf8'));
} catch (error) {
  process.stderr.write(`DownFlow download job: ${error instanceof Error ? error.message : error}\n`);
  process.exit(2);
}

if (!job?.id || !job?.url || !job?.format) {
  process.stderr.write('DownFlow download job: incomplete job data\n');
  process.exit(2);
}

function currentJob() {
  try {
    return JSON.parse(readFileSync(jobPath(job.id), 'utf8'));
  } catch {
    return undefined;
  }
}

function isCancelled() {
  return currentJob()?.status === 'cancelled';
}

const startTime = Date.now();
const outputDir = ensureDir(job.outputDir || downloadsRoot());
const ytDlp = findYtDlp();
const ffmpeg = findFfmpeg();
let totalBytes = Number(job.totalBytes) || 0;
let downloadedBytes = 0;
let speedBps = 0;
let etaSeconds = null;
let finalPath;
let lastWrite = 0;
let stage = 'downloading';
let stderrTail = [];

function persist(force = false) {
  if (!force && Date.now() - lastWrite < 400) return;
  if (isCancelled()) process.exit(0);
  lastWrite = Date.now();
  const percent = totalBytes > 0 ? Math.min(100, (downloadedBytes / totalBytes) * 100) : undefined;
  writeJob(job.id, {
    id: job.id,
    status: stage,
    title: job.title,
    filename: finalPath ? basename(finalPath) : job.filename,
    outputPath: finalPath,
    totalBytes: totalBytes || undefined,
    downloadedBytes,
    speedBps,
    etaSeconds,
    percent,
    pid: process.pid,
    startedAt: job.startedAt || startTime,
  });
}

function parseNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function newestMatch() {
  try {
    const files = readdirSync(outputDir)
      .map((name) => join(outputDir, name))
      .filter((path) => {
        try {
          const info = statSync(path);
          return info.isFile() && !/\.(part|ytdl|temp)$/i.test(path) && info.mtimeMs >= startTime - 2000;
        } catch {
          return false;
        }
      })
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    return files[0];
  } catch {
    return undefined;
  }
}

if (!ytDlp) {
  writeJob(job.id, {
    id: job.id,
    status: 'failed',
    error: 'yt-dlp was not found. Run the DownFlow native installer and install yt-dlp first.',
    pid: process.pid,
    startedAt: startTime,
  });
  process.exit(1);
}

const outputTemplate = job.customFilename
  ? join(outputDir, `${sanitizeStem(job.filenameStem || job.filename || job.title)}.%(ext)s`)
  : join(outputDir, '%(title).150B [%(id)s].%(ext)s');

const args = [
  '--no-playlist',
  '--no-warnings',
  '--newline',
  '--progress',
  '--no-simulate',
  '--continue',
  '--retries',
  '5',
  '--fragment-retries',
  '5',
  '--concurrent-fragments',
  '4',
  '--windows-filenames',
  '--trim-filenames',
  '180',
  '--progress-template',
  'download:DFPROG:%(progress.downloaded_bytes)s:%(progress.total_bytes)s:%(progress.total_bytes_estimate)s:%(progress.speed)s:%(progress.eta)s',
  '--progress-template',
  'postprocess:DFPOST:%(progress.status)s',
  '--print',
  'after_move:DFFILE:%(filepath)s',
  '-f',
  job.format,
  '-o',
  outputTemplate,
  job.url,
];

if (ffmpeg) {
  args.unshift('--ffmpeg-location', dirname(ffmpeg));
  if (job.merge) {
    const container = /^(mp4|mov|m4v)$/i.test(job.ext || '') ? 'mp4' : 'mkv';
    args.unshift('--merge-output-format', container);
  }
}

stage = 'downloading';
persist(true);

const child = spawn(ytDlp, args, {
  cwd: outputDir,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
});

let buffer = '';
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (line.startsWith('DFPROG:')) {
      const [, downloaded, total, estimate, speed, eta] = line.split(':');
      downloadedBytes = parseNumber(downloaded);
      totalBytes = parseNumber(total) || parseNumber(estimate) || totalBytes;
      speedBps = parseNumber(speed);
      const remaining = parseNumber(eta);
      etaSeconds = remaining > 0 ? Math.round(remaining) : null;
      if (stage !== 'merging') stage = 'downloading';
      persist();
      continue;
    }
    if (line.startsWith('DFPOST:')) {
      stage = 'merging';
      persist(true);
      continue;
    }
    if (line.startsWith('DFFILE:')) {
      finalPath = line.slice('DFFILE:'.length).trim() || undefined;
      persist(true);
    }
  }
});

child.stderr.on('data', (chunk) => {
  const text = chunk.toString('utf8').trim();
  if (!text) return;
  stderrTail = [...stderrTail, ...text.split(/\r?\n/)].slice(-8);
});

child.on('error', (error) => {
  writeJob(job.id, {
    id: job.id,
    status: 'failed',
    error: `Could not start yt-dlp: ${error.message}`,
    pid: process.pid,
    startedAt: startTime,
  });
  process.exit(1);
});

child.on('close', (code) => {
  if (isCancelled()) process.exit(0);
  if (code === 0) {
    finalPath = finalPath || newestMatch();
    stage = 'completed';
    if (!totalBytes && finalPath) {
      try {
        totalBytes = statSync(finalPath).size;
        downloadedBytes = totalBytes;
      } catch {
        // The final size is cosmetic; yt-dlp already reported success.
      }
    }
    downloadedBytes = totalBytes || downloadedBytes;
    speedBps = 0;
    etaSeconds = null;
    writeJob(job.id, {
      id: job.id,
      status: 'completed',
      title: job.title,
      filename: finalPath ? basename(finalPath) : job.filename,
      outputPath: finalPath,
      totalBytes: totalBytes || undefined,
      downloadedBytes,
      speedBps: 0,
      etaSeconds: null,
      percent: 100,
      pid: process.pid,
      startedAt: startTime,
      completedAt: Date.now(),
    });
    process.exit(0);
  }

  const tail = stderrTail.join('\n').trim();
  writeJob(job.id, {
    id: job.id,
    status: 'failed',
    title: job.title,
    filename: job.filename,
    outputPath: finalPath,
    totalBytes: totalBytes || undefined,
    downloadedBytes,
    speedBps: 0,
    etaSeconds: null,
    error: tail || `yt-dlp exited with code ${code}.`,
    pid: process.pid,
    startedAt: startTime,
  });
  process.exit(code || 1);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('uncaughtException', (error) => {
  writeJob(job.id, {
    id: job.id,
    status: 'failed',
    error: error instanceof Error ? error.message : String(error),
    pid: process.pid,
    startedAt: startTime,
  });
  process.exit(1);
});
