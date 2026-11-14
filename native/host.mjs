import { execFile, spawn } from 'node:child_process';
import { appendFileSync, closeSync, openSync } from 'node:fs';
import { ensureDir, downloadsRoot, helperStatus, jobsRoot, jobPath, killProcessTree, openPath, readJob, revealPath, stripProbe, writeJob } from './lib.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const jobScript = join(here, 'download-job.mjs');

function logLine(text) {
  try {
    ensureDir(jobsRoot());
    appendFileSync(join(jobsRoot(), 'helper.log'), `${new Date().toISOString()} ${text}\n`, 'utf8');
  } catch {
    // Logging is diagnostic only.
  }
}

function send(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

function run(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || error.message || '').trim().split(/\r?\n/).slice(-4).join(' ');
          reject(new Error(detail || 'The helper command failed.'));
          return;
        }
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
      },
    );
  });
}

function isAlive(pid) {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readState(id) {
  const state = readJob(id);
  if (!state) return undefined;
  if ((state.status === 'downloading' || state.status === 'merging') && !isAlive(state.pid)) {
    const failed = {
      ...state,
      status: 'failed',
      error: state.error || 'The helper download process stopped unexpectedly. Retry to continue.',
    };
    writeJob(id, failed);
    return failed;
  }
  return state;
}

async function probe(url, timeoutMs) {
  const startedAt = Date.now();
  logLine(`probe enter ${url} timeoutMs=${timeoutMs}`);
  const status = helperStatus();
  logLine(`probe status ytdlp=${status.ytDlp.path || 'missing'}`);
  if (!status.ytDlp.available || !status.ytDlp.path) {
    throw new Error(
      'yt-dlp is not installed for the DownFlow helper. Run the native installer, then install yt-dlp or let the installer download it.',
    );
  }
  if (!/^https?:\/\//i.test(url || '')) throw new Error('Only HTTP and HTTPS links can be probed.');
  const args = [
    '--dump-single-json',
    '--no-playlist',
    '--no-warnings',
    '--skip-download',
    '--no-check-formats',
    '--socket-timeout',
    '20',
    '--retries',
    '2',
    url,
  ];
  const { stdout } = await run(status.ytDlp.path, args, Math.max(15_000, Math.min(Number(timeoutMs) || 90_000, 180_000)));
  logLine(`probe yt-dlp done in ${Date.now() - startedAt}ms bytes=${stdout.length}`);
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error('yt-dlp returned metadata DownFlow could not read. Try again or update yt-dlp.');
  }
  return stripProbe(parsed, url);
}

async function start(job) {
  if (!job || !job.id || !job.url || !job.format) throw new Error('The download request is incomplete.');
  const status = helperStatus();
  if (!status.ytDlp.available || !status.ytDlp.path) {
    throw new Error(
      'yt-dlp is not installed for the DownFlow helper. Run the native installer, then install yt-dlp or let the installer download it.',
    );
  }
  if (job.merge && !status.ffmpeg.available) {
    throw new Error('This quality needs FFmpeg to merge the video and audio streams. Install FFmpeg and try again.');
  }

  const outputDir = ensureDir(job.outputDir || downloadsRoot());
  ensureDir(jobsRoot());
  const state = {
    id: job.id,
    status: 'queued',
    title: job.title,
    filename: job.filename,
    url: job.url,
    format: job.format,
    filenameStem: job.filenameStem,
    customFilename: Boolean(job.customFilename),
    ext: job.ext,
    merge: Boolean(job.merge),
    outputDir,
    outputPath: undefined,
    totalBytes: Number(job.totalBytes) || undefined,
    downloadedBytes: 0,
    speedBps: 0,
    etaSeconds: null,
    startedAt: Date.now(),
  };
  writeJob(job.id, state);

  const logFd = openSync(join(jobsRoot(), `${job.id}.log`), 'a');
  const child = spawn(process.execPath, [jobScript, jobPath(job.id)], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
    cwd: outputDir,
  });
  child.unref();
  closeSync(logFd);
  return { ...state, pid: child.pid };
}

async function handle(message) {
  switch (message?.type) {
    case 'ping':
      return { pong: true, hostVersion: helperStatus().hostVersion };
    case 'status':
      return helperStatus();
    case 'probe':
      return probe(String(message.url || ''), message.timeoutMs);
    case 'start':
      return start(message.job);
    case 'job':
      return readState(String(message.id || '')) ?? null;
    case 'jobs': {
      const ids = Array.isArray(message.ids) ? message.ids.slice(0, 100) : [];
      const result = {};
      for (const id of ids) result[id] = readState(String(id)) ?? null;
      return result;
    }
    case 'cancel': {
      const id = String(message.id || '');
      const state = readJob(id);
      if (state?.pid) killProcessTree(state.pid);
      const cancelled = {
        ...(state || { id }),
        id,
        status: 'cancelled',
        speedBps: 0,
        etaSeconds: null,
      };
      writeJob(id, cancelled);
      return cancelled;
    }
    case 'open':
      openPath(String(message.path || ''));
      return true;
    case 'reveal':
      revealPath(String(message.path || ''));
      return true;
    case 'output-dir':
      return ensureDir(downloadsRoot());
    default:
      throw new Error(`Unknown helper request: ${message?.type ?? 'missing'}`);
  }
}

let buffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (buffer.length < 4 + length) break;
    const text = buffer.subarray(4, 4 + length).toString('utf8');
    buffer = buffer.subarray(4 + length);
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      send({ ok: false, error: 'The helper received invalid JSON.' });
      continue;
    }
    const requestId = message?.requestId;
    void (async () => {
      const startedAt = Date.now();
      try {
        const data = await handle(message);
        if (message?.type === 'probe') logLine(`probe done #${requestId} in ${Date.now() - startedAt}ms`);
        send({ requestId, ok: true, data });
      } catch (error) {
        logLine(`fail ${message?.type} #${requestId} in ${Date.now() - startedAt}ms: ${error instanceof Error ? error.message : String(error)}`);
        send({ requestId, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
  }
});

process.stdin.on('end', () => {
  logLine(`stdin end pid=${process.pid}`);
  process.exit(0);
});
process.on('uncaughtException', (error) => {
  logLine(`uncaught pid=${process.pid} ${error instanceof Error ? error.stack : String(error)}`);
  process.stderr.write(`DownFlow helper error: ${error instanceof Error ? error.stack : String(error)}\n`);
});
