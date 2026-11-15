#!/usr/bin/env node
/**
 * Captures store/README screenshots of a real in-progress download.
 *
 * Launches a Chromium browser with dist/ loaded, starts three slow segmented
 * downloads against a local throttled HTTP server, then captures the Downloading
 * and Overview pages at 1280x800. The bytes, speeds, ETAs and segment strips in
 * the images come from the running engines, not from injected fake records.
 *
 * Usage: node scripts/capture-screenshots.mjs [--browser "C:\path\to\browser.exe"]
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve('.');
const dist = join(root, 'dist');
const tempRoot = join(process.env.LOCALAPPDATA || process.env.TEMP || '.', 'Temp', 'opencode');
const outputDir = join(root, 'store', 'screenshots');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const MB = 1024 * 1024;

const DEMOS = [
  {
    path: '/aurora.mp4',
    filename: 'Aurora - 4K Nature Film.mp4',
    mime: 'video/mp4',
    pageUrl: 'https://media.example.com/aurora-4k',
    size: 28 * MB,
  },
  {
    path: '/design-kit.zip',
    filename: 'Product Design Kit.zip',
    mime: 'application/zip',
    pageUrl: 'https://files.example.com/design-kit',
    size: 20 * MB,
  },
  {
    path: '/focus-sessions.mp3',
    filename: 'Focus Sessions Vol. 3.mp3',
    mime: 'audio/mpeg',
    pageUrl: 'https://audio.example.com/focus-sessions',
    size: 14 * MB,
  },
];

function candidates() {
  const explicit = process.argv.indexOf('--browser');
  if (explicit !== -1 && process.argv[explicit + 1]) return [process.argv[explicit + 1]];
  if (process.env.DOWNFLOW_BROWSER) return [process.env.DOWNFLOW_BROWSER];
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA || '';
  return [
    join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter((candidate) => existsSync(candidate));
}

function freePort() {
  return 9500 + Math.floor(Math.random() * 400);
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const entry = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
      else entry.resolve(message.result);
    };
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolvePromise, reject) => {
      ws.onopen = resolvePromise;
      ws.onerror = () => reject(new Error(`Could not connect to ${url}`));
    });
    return new Cdp(ws);
  }

  send(method, params = {}) {
    return new Promise((resolvePromise, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 20_000);
    });
  }

  close() {
    this.ws.close();
  }
}

async function launch(browserPath) {
  const port = freePort();
  const profile = join(tempRoot, `downflow-shot-profile-${port}`);
  const downloads = join(tempRoot, `downflow-shot-downloads-${port}`);
  rmSync(profile, { recursive: true, force: true });
  rmSync(downloads, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  mkdirSync(downloads, { recursive: true });

  const child = spawn(
    browserPath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,800',
      `--user-data-dir=${profile}`,
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      `--remote-debugging-port=${port}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const cleanup = async () => {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGKILL');
    }
    await sleep(700);
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        rmSync(profile, { recursive: true, force: true });
        rmSync(downloads, { recursive: true, force: true });
        return;
      } catch {
        await sleep(300);
      }
    }
  };

  let version;
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      await sleep(250);
      try {
        version = await getJson(`http://127.0.0.1:${port}/json/version`);
        if (version.webSocketDebuggerUrl) break;
      } catch {}
    }
    if (!version?.webSocketDebuggerUrl) throw new Error('Browser DevTools endpoint did not start.');

    const browser = await Cdp.connect(version.webSocketDebuggerUrl);
    await browser.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloads,
      eventsEnabled: true,
    });

    let targets = [];
    for (let attempt = 0; attempt < 40; attempt++) {
      targets = await getJson(`http://127.0.0.1:${port}/json/list`).catch(() => []);
      if (targets.some((target) => target.type === 'page')) break;
      await sleep(250);
    }
    const pageTarget = targets.find((target) => target.type === 'page');
    if (!pageTarget) throw new Error('No browser page target was available.');
    const page = await Cdp.connect(pageTarget.webSocketDebuggerUrl);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });

    return { child, browser, page, port, profile, downloads, version, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function findExtension(page) {
  await page.send('Page.navigate', { url: 'chrome://extensions' });
  await sleep(1500);
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const result = await page.send('Runtime.evaluate', {
        expression:
          'new Promise((resolve) => chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true }, (info) => resolve(info.map((entry) => ({ id: entry.id, name: entry.name, state: entry.state, location: entry.location, errors: entry.manifestErrors })))))',
        awaitPromise: true,
        returnByValue: true,
      });
      const info = result.result?.value;
      const match = info?.find((entry) => /downflow/i.test(entry.name));
      if (match) return match;
    } catch {}
    await sleep(500);
  }
  return null;
}

async function waitFor(check, timeoutMs = 30_000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last) return last;
    await sleep(intervalMs);
  }
  return last;
}

function createPageHelpers(page, extensionId) {
  async function evaluate(expression) {
    const result = await page.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Page evaluation failed',
      );
    }
    return result.result?.value;
  }

  async function request(payload, timeoutMs = 20_000) {
    return evaluate(
      `new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ ok: false, error: 'message timeout' }), ${timeoutMs});
        chrome.runtime.sendMessage(${JSON.stringify(payload)}, (response) => {
          clearTimeout(timer);
          resolve(response ?? { ok: false, error: 'no response' });
        });
      })`,
    );
  }

  async function openPage(path) {
    await page.send('Page.navigate', { url: `chrome-extension://${extensionId}/${path}` });
    return waitFor(async () => {
      try {
        return await evaluate("document.readyState === 'complete' && (document.getElementById('root')?.children.length ?? 0) > 0");
      } catch {
        return false;
      }
    }, 20_000);
  }

  return { evaluate, request, openPage };
}

async function startSlowServer() {
  // Chrome caps connections per origin (scheme + host + port). Serving all
  // demos from one port would starve the third download behind the first two
  // once their segment streams hold the connection pool open, so give each
  // demo its own port.
  const servers = [];
  const urls = [];

  for (const demo of DEMOS) {
    const body = Buffer.alloc(demo.size, demo.path.charCodeAt(1) % 251);
    const total = body.length;

    const server = createServer(async (request, response) => {
      const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
      let start = 0;
      let end = total - 1;
      if (match) {
        start = Number(match[1]);
        end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
        if (!Number.isFinite(start) || start > end || start >= total) {
          response.writeHead(416, { 'Content-Range': `bytes */${total}` });
          response.end();
          return;
        }
      }

      const length = end - start + 1;
      const headers = {
        'Content-Type': demo.mime,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Range',
        'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, ETag',
        'ETag': `"downflow-shot-${demo.path.slice(1)}"`,
        'Content-Disposition': `attachment; filename="${demo.filename}"`,
      };

      if (match) {
        response.writeHead(206, {
          ...headers,
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Content-Length': String(length),
        });
      } else {
        response.writeHead(200, { ...headers, 'Content-Length': String(total) });
      }

      if (request.method === 'HEAD') {
        response.end();
        return;
      }

      // The 0-0 request is the Range probe; answer it immediately.
      if (start === 0 && end === 0) {
        response.end(body.subarray(0, 1));
        return;
      }

      const step = 16 * 1024;
      for (let offset = start; offset <= end; offset += step) {
        if (response.destroyed) return;
        const piece = body.subarray(offset, Math.min(offset + step, end + 1));
        if (!response.write(piece)) {
          await new Promise((resolvePromise) => response.once('drain', resolvePromise));
        }
        await sleep(140);
      }
      response.end();
    });

    await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
    servers.push(server);
    urls.push({ ...demo, url: `http://127.0.0.1:${server.address().port}${demo.path}` });
  }

  return {
    urls,
    close: () =>
      Promise.all(
        servers.map(
          (server) =>
            new Promise((resolvePromise) => {
              server.close(() => resolvePromise());
              server.closeAllConnections?.();
            }),
        ),
      ),
  };
}

function capture(page, file) {
  return page.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).then((result) => {
    const buffer = Buffer.from(result.data, 'base64');
    if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error(`Not a PNG: ${file}`);
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width !== 1280 || height !== 800) throw new Error(`Unexpected size ${width}x${height} for ${file}`);
    writeFileSync(file, buffer);
    return { file, width, height, bytes: buffer.length };
  });
}

async function main() {
  if (!existsSync(join(dist, 'manifest.json'))) {
    console.error('dist/manifest.json is missing. Run `npm run build` first.');
    process.exit(1);
  }
  mkdirSync(tempRoot, { recursive: true });
  mkdirSync(outputDir, { recursive: true });

  let session = null;
  let extension = null;
  for (const browserPath of candidates()) {
    console.log(`Trying ${browserPath}`);
    try {
      const candidate = await launch(browserPath);
      const found = await findExtension(candidate.page);
      if (found) {
        session = candidate;
        extension = found;
        console.log(`Loaded extension ${found.name} (${found.id})`);
        break;
      }
      await candidate.cleanup();
    } catch (error) {
      console.log(`  ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!session || !extension) {
    console.error('Could not load the extension in Chrome or Edge. Run `npm run build` first.');
    process.exit(1);
  }

  const { page, cleanup } = session;
  const helpers = createPageHelpers(page, extension.id);
  const server = await startSlowServer();
  const startedIds = [];

  try {
    // chrome://extensions does not expose chrome.runtime.sendMessage, so open an
    // extension page before talking to the background service worker.
    if (!(await helpers.openPage('dashboard.html#/overview'))) {
      throw new Error('The dashboard did not render.');
    }
    await helpers.request({ type: 'settings:update', patch: { theme: 'dark', segmentedEnabled: true, segmentCount: 4, maxConcurrent: 3 } });

    for (const demo of server.urls) {
      const started = await helpers.request({
        type: 'downloads:start',
        payload: {
          url: demo.url,
          filename: demo.filename,
          mime: demo.mime,
          pageUrl: demo.pageUrl,
          source: 'dashboard',
        },
      });
      if (started?.ok !== true) throw new Error(started?.error ?? `Could not start ${demo.filename}`);
      startedIds.push(started.data.record.id);
      console.log(`Started ${demo.filename} (${started.data.record.id})`);
    }

    let lastSummary = '';
    const ready = await waitFor(async () => {
      const response = await helpers.request({ type: 'downloads:list' });
      const records = (response?.data?.downloads ?? []).filter((record) => startedIds.includes(record.id));
      const summary = records
        .map((record) => `${record.filename.split(' ')[0]}=${record.status}:${record.downloadedBytes}`)
        .join(' ');
      if (summary !== lastSummary) {
        lastSummary = summary;
        console.log(`  ${summary}`);
      }
      if (records.length !== DEMOS.length) return null;
      const active = records.filter((record) => record.status === 'downloading');
      const progressed = active.every((record) => record.downloadedBytes > 1.5 * MB);
      return active.length === DEMOS.length && progressed ? records : null;
    }, 45_000, 3000);
    if (!ready) throw new Error('The demo downloads did not reach a live progress state in time.');
    console.log(
      ready
        .map((record) => `${record.filename}: ${record.downloadedBytes}/${record.totalBytes} @ ${record.speedBps} B/s`)
        .join('\n'),
    );

    if (!(await helpers.openPage('dashboard.html#/downloading'))) throw new Error('The Downloading page did not render.');
    await waitFor(
      () => helpers.evaluate("document.querySelectorAll('.download-card .status-tag.downloading').length >= 3"),
      10_000,
    );
    await helpers.evaluate('window.scrollTo(0, 0)');
    await sleep(700);
    const downloadingText = await helpers.evaluate(
      "Array.from(document.querySelectorAll('.download-card')).map((card) => card.innerText.replace(/\\n/g, ' | ')).join('\\n')",
    );
    console.log(`Downloading page cards:\n${downloadingText}`);
    if (!/%/.test(downloadingText) || !/(\/s|B\/s)/.test(downloadingText) || !/segments/.test(downloadingText)) {
      throw new Error('The Downloading page is not showing live progress details.');
    }
    const downloadingShot = await capture(page, join(outputDir, 'dashboard-downloading-1280x800.png'));
    console.log(`Captured ${downloadingShot.file} (${downloadingShot.width}x${downloadingShot.height})`);

    if (!(await helpers.openPage('dashboard.html#/overview'))) throw new Error('The Overview page did not render.');
    await helpers.evaluate('window.scrollTo(0, 0)');
    await sleep(1200);
    const overviewText = await helpers.evaluate('document.querySelector(".page-head")?.innerText ?? ""');
    console.log(`Overview header: ${overviewText.replace(/\n/g, ' | ')}`);
    if (!/active download/i.test(overviewText)) {
      throw new Error('The Overview page is not reporting active downloads.');
    }
    const overviewShot = await capture(page, join(outputDir, 'dashboard-overview-1280x800.png'));
    console.log(`Captured ${overviewShot.file} (${overviewShot.width}x${overviewShot.height})`);

    const png = readFileSync(downloadingShot.file);
    console.log(`Screenshots saved under ${outputDir} (${(png.length / 1024).toFixed(0)} KiB first image).`);
  } finally {
    for (const id of startedIds) {
      await helpers.request({ type: 'downloads:cancel', id }).catch(() => undefined);
      await helpers.request({ type: 'downloads:remove', id }).catch(() => undefined);
    }
    await server.close();
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
