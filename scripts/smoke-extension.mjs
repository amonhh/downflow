#!/usr/bin/env node
/**
 * Real-browser smoke test for the built DownFlow extension.
 *
 * It launches a Chromium-based browser with `dist/` loaded as an unpacked
 * extension, verifies the popup and dashboard render, calls the real
 * background message API, creates/deletes a schedule, and completes one
 * native Chrome download against a local HTTP server.
 *
 * Branded Google Chrome builds may ignore `--load-extension`; the script
 * therefore tries Chrome first and falls back to Microsoft Edge, which is a
 * Chromium browser and supports the same extension APIs. The report records
 * which browser was actually used.
 *
 * Usage: node scripts/smoke-extension.mjs [--browser "C:\path\to\browser.exe"]
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve('.');
const dist = join(root, 'dist');
const tempRoot = join(process.env.LOCALAPPDATA || process.env.TEMP || '.', 'Temp', 'opencode');
const reportPath = join(root, 'BROWSER_SMOKE_REPORT.md');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function publicPath(value) {
  if (!value) return 'n/a';
  const home = process.env.USERPROFILE || process.env.HOME;
  return home ? String(value).replaceAll(home, '%USERPROFILE%') : String(value);
}

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
  return 9400 + Math.floor(Math.random() * 400);
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
    this.listeners = new Map();
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) entry.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
        else entry.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
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

  on(method, listener) {
    const list = this.listeners.get(method) ?? [];
    list.push(listener);
    this.listeners.set(method, list);
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
      }, 15_000);
    });
  }

  close() {
    this.ws.close();
  }
}

async function launch(browserPath) {
  const port = freePort();
  const profile = join(tempRoot, `downflow-smoke-profile-${port}`);
  const downloads = join(tempRoot, `downflow-smoke-downloads-${port}`);
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
    await page.send('Log.enable');
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    return { child, browser, page, port, profile, downloads, version, cleanup, pageTarget };
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

async function waitFor(check, timeoutMs = 20_000, intervalMs = 250) {
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
  const issues = [];

  page.on('Runtime.exceptionThrown', (params) => {
    issues.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? 'Unknown exception');
  });
  page.on('Runtime.consoleAPICalled', (params) => {
    if (params.type !== 'error') return;
    const text = (params.args ?? [])
      .map((arg) => arg.value ?? arg.description ?? '')
      .join(' ')
      .slice(0, 500);
    if (text) issues.push(`console.error: ${text}`);
  });
  page.on('Log.entryAdded', (params) => {
    if (params.entry?.level === 'error' && params.entry?.url?.startsWith('chrome-extension://')) {
      issues.push(`log: ${params.entry.text}`);
    }
  });

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

  async function openPage(path) {
    issues.length = 0;
    await page.send('Page.navigate', { url: `chrome-extension://${extensionId}/${path}` });
    const ready = await waitFor(async () => {
      try {
        return await evaluate("document.readyState === 'complete' && (document.getElementById('root')?.children.length ?? 0) > 0");
      } catch {
        return false;
      }
    }, 20_000);
    await sleep(600);
    const text = ready ? await evaluate('document.body.innerText') : '';
    return { ready: Boolean(ready), text: String(text ?? ''), issues: [...issues] };
  }

  async function request(payload, timeoutMs = 20_000) {
    const result = await evaluate(
      `new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ ok: false, error: 'message timeout' }), ${timeoutMs});
        chrome.runtime.sendMessage(${JSON.stringify(payload)}, (response) => {
          clearTimeout(timer);
          resolve(response ?? { ok: false, error: 'no response' });
        });
      })`,
    );
    return result;
  }

  return { openPage, request, issues, evaluate };
}

async function startLocalServer() {
  const smallBody = Buffer.alloc(128 * 1024);
  for (let index = 0; index < smallBody.length; index++) smallBody[index] = index % 251;
  const segmentedBody = Buffer.alloc(5 * 1024 * 1024);
  for (let index = 0; index < segmentedBody.length; index++) segmentedBody[index] = index % 251;

  const serve = (body, request, response, contentType, filename) => {
    const range = request.headers.range;
    if (range) {
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (match) {
        const start = Number(match[1]);
        const end = Math.min(Number(match[2]), body.length - 1);
        const chunk = body.subarray(start, end + 1);
        response.writeHead(206, {
          'Content-Type': contentType,
          'Content-Length': String(chunk.length),
          'Content-Range': `bytes ${start}-${end}/${body.length}`,
          'Accept-Ranges': 'bytes',
        });
        response.end(chunk);
        return;
      }
    }
    response.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': String(body.length),
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    response.end(body);
  };

  const server = createServer((request, response) => {
    if (request.url?.startsWith('/downflow-segmented.bin')) {
      serve(segmentedBody, request, response, 'application/octet-stream', 'downflow-segmented.bin');
      return;
    }
    serve(smallBody, request, response, 'text/plain', 'downflow-smoke.txt');
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    url: `${base}/downflow-smoke.txt`,
    segmentedUrl: `${base}/downflow-segmented.bin`,
    size: smallBody.length,
    segmentedSize: segmentedBody.length,
    close: () =>
      new Promise((resolvePromise) => {
        server.close(() => resolvePromise());
        server.closeAllConnections?.();
      }),
  };
}

function findDownloadedFile(directory, fragment) {
  const found = [];
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      const stats = statSync(full);
      if (stats.isDirectory()) walk(full);
      else if (name.toLowerCase().includes(fragment.toLowerCase())) found.push(full);
    }
  };
  walk(directory);
  return found;
}

async function main() {
  if (!existsSync(join(dist, 'manifest.json'))) {
    console.error('dist/manifest.json is missing. Run `npm run build` first.');
    process.exit(1);
  }

  mkdirSync(tempRoot, { recursive: true });
  const attempts = [];
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
      attempts.push({ browserPath, version: candidate.version.Browser, result: 'extension not loaded (branded build may block --load-extension)' });
      await candidate.cleanup();
    } catch (error) {
      attempts.push({ browserPath, result: `launch failed: ${error.message}` });
    }
  }

  if (!session || !extension) {
    const text = [
      '# DownFlow browser smoke report',
      '',
      '**FAIL - the built extension could not be loaded by any browser found on this machine.**',
      '',
      ...attempts.map((attempt) => `- ${attempt.browserPath}: ${attempt.result}`),
      '',
      'Branded Google Chrome builds can ignore `--load-extension`. Install Chrome for Testing or load',
      '`dist/` manually through `chrome://extensions` and follow `docs/CHROME_VERIFICATION.md`.',
      '',
    ].join('\n');
    writeFileSync(reportPath, text, 'utf8');
    console.error(text);
    process.exit(1);
  }

  const { page, browser, downloads, version, cleanup } = session;
  const helpers = createPageHelpers(page, extension.id);
  const checks = [];
  const local = await startLocalServer();
  const record = (name, passed, detail = '') => {
    checks.push({ name, passed, detail });
    console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
  };

  try {
    const popup = await helpers.openPage('popup.html');
    record(
      'Popup renders without runtime errors',
      popup.ready && /DownFlow/i.test(popup.text) && popup.issues.length === 0,
      popup.issues.join('; ') || `${popup.text.length} characters rendered`,
    );

    const dashboard = await helpers.openPage('dashboard.html');
    const dashboardTokens = ['Overview', 'All downloads', 'Queued', 'Scheduler', 'Settings'];
    const missing = dashboardTokens.filter((token) => !dashboard.text.includes(token));
    record(
      'Dashboard renders all primary navigation',
      dashboard.ready && missing.length === 0 && dashboard.issues.length === 0,
      dashboard.issues.join('; ') || (missing.length ? `missing: ${missing.join(', ')}` : 'all navigation labels present'),
    );

    const settingsResponse = await helpers.request({ type: 'settings:get' });
    record(
      'Background API returns persisted settings',
      settingsResponse?.ok === true && typeof settingsResponse.data?.defaultFolder === 'string',
      settingsResponse?.ok === false ? settingsResponse.error : `theme=${settingsResponse?.data?.theme}`,
    );

    const infoResponse = await helpers.request({ type: 'system:get-info' });
    record(
      'Background API reports version and capabilities',
      infoResponse?.ok === true && Boolean(infoResponse.data?.version),
      infoResponse?.ok === false ? infoResponse.error : `version=${infoResponse?.data?.version}`,
    );

    const listResponse = await helpers.request({ type: 'downloads:list' });
    record(
      'Download list endpoint returns a valid shape',
      listResponse?.ok === true && Array.isArray(listResponse.data?.downloads),
      listResponse?.ok === false ? listResponse.error : `${listResponse?.data?.downloads?.length ?? 0} records`,
    );

    const mediaResponse = await helpers.request({ type: 'media:list' });
    record(
      'Media library endpoint returns a valid shape',
      mediaResponse?.ok === true && Array.isArray(mediaResponse.data),
      mediaResponse?.ok === false ? mediaResponse.error : `${mediaResponse?.data?.length ?? 0} resources`,
    );

    const statsResponse = await helpers.request({ type: 'stats:get' });
    record(
      'Statistics endpoint derives data from stored records',
      statsResponse?.ok === true && typeof statsResponse.data?.totalDownloads === 'number',
      statsResponse?.ok === false ? statsResponse.error : `totalDownloads=${statsResponse?.data?.totalDownloads}`,
    );

    const created = await helpers.request({
      type: 'schedules:create',
      payload: {
        name: 'DownFlow smoke schedule',
        action: 'start-queue',
        mode: 'once',
        runAt: Date.now() + 60 * 60 * 1000,
        maxDownloads: 1,
        enabled: false,
      },
    });
    const scheduleId = created?.data?.id;
    const listed = scheduleId ? await helpers.request({ type: 'schedules:list' }) : null;
    const foundSchedule = listed?.data?.some?.((schedule) => schedule.id === scheduleId);
    if (scheduleId) await helpers.request({ type: 'schedules:delete', id: scheduleId });
    record(
      'Scheduler persists and deletes a schedule',
      created?.ok === true && foundSchedule === true,
      created?.ok === false ? created.error : `schedule ${scheduleId}`,
    );

    const started = await helpers.request({
      type: 'downloads:start',
      payload: {
        url: local.url,
        filename: 'downflow-smoke.txt',
        mime: 'text/plain',
        source: 'manual',
        kind: 'standard',
      },
    });
    const downloadId = started?.data?.record?.id;
    record(
      'Native download starts through Chrome Downloads',
      started?.ok === true && typeof downloadId === 'string',
      started?.ok === false ? started.error : `download ${downloadId}`,
    );

    let finalRecord = null;
    if (downloadId) {
      finalRecord = await waitFor(async () => {
        const response = await helpers.request({ type: 'downloads:list' });
        const found = response?.data?.downloads?.find((entry) => entry.id === downloadId);
        return found && ['completed', 'failed', 'cancelled', 'paused'].includes(found.status) ? found : null;
      }, 30_000, 500);
    }
    const files = findDownloadedFile(downloads, 'downflow-smoke');
    record(
      'Native download completes and writes the file',
      finalRecord?.status === 'completed' &&
        finalRecord?.downloadedBytes === local.size &&
        files.length > 0,
      finalRecord
        ? `status=${finalRecord.status}, bytes=${finalRecord.downloadedBytes}/${local.size}, files=${files.length}`
        : 'download did not finish',
    );

    if (downloadId && finalRecord?.chromeDownloadId) {
      await helpers
        .evaluate(
          `Promise.all([
            chrome.downloads.removeFile(${finalRecord.chromeDownloadId}).catch(() => undefined),
            chrome.downloads.erase({ id: ${finalRecord.chromeDownloadId} }).catch(() => undefined)
          ]).then(() => true)`,
        )
        .catch(() => undefined);
    }
    if (downloadId) await helpers.request({ type: 'downloads:remove', id: downloadId });

    const settingsWrite = await helpers.request({
      type: 'settings:update',
      patch: { notifications: true },
    });
    const settingsRead = await helpers.request({ type: 'settings:get' });
    record(
      'Settings write persists across calls',
      settingsWrite?.ok === true && settingsRead?.data?.notifications === true,
      settingsWrite?.ok === false ? settingsWrite.error : 'notifications=true',
    );

    const segmentedSettings = await helpers.request({
      type: 'settings:update',
      patch: { segmentedEnabled: true, segmentCount: 4, maxConnections: 4, memoryLimitMb: 512, autoRetry: true },
    });
    record(
      'Segmented download settings can be enabled',
      segmentedSettings?.ok === true && segmentedSettings.data?.segmentedEnabled === true,
      segmentedSettings?.ok === false ? segmentedSettings.error : 'segmentedEnabled=true',
    );

    const probe = await helpers.request({ type: 'downloads:probe', url: local.segmentedUrl });
    record(
      'Range probe reports segmented support from the service worker',
      probe?.ok === true && probe.data?.supported === true && probe.data?.totalBytes === local.segmentedSize,
      probe?.ok === false ? probe.error : `supported=${probe?.data?.supported}, bytes=${probe?.data?.totalBytes}`,
    );

    const segmentedStart = await helpers.request({
      type: 'downloads:start',
      payload: {
        url: local.segmentedUrl,
        filename: 'downflow-segmented.bin',
        mime: 'application/octet-stream',
        source: 'manual',
      },
    });
    const segmentedId = segmentedStart?.data?.record?.id;
    record(
      'Segmented download is accepted by the coordinator',
      segmentedStart?.ok === true && typeof segmentedId === 'string',
      segmentedStart?.ok === false ? segmentedStart.error : `download ${segmentedId}`,
    );

    let segmentedRecord = null;
    if (segmentedId) {
      segmentedRecord = await waitFor(async () => {
        const response = await helpers.request({ type: 'downloads:list' });
        const found = response?.data?.downloads?.find((entry) => entry.id === segmentedId);
        return found && ['completed', 'failed', 'cancelled', 'paused'].includes(found.status) ? found : null;
      }, 60_000, 500);
    }
    const segmentedFiles = findDownloadedFile(downloads, 'downflow-segmented');
    const segmentedFileSize = segmentedFiles.length ? statSync(segmentedFiles[0]).size : 0;
    let downloadTree = [];
    try {
      const walk = (dir) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else downloadTree.push(`${name}:${statSync(full).size}`);
        }
      };
      walk(downloads);
    } catch {}
    record(
      'Segmented engine downloads, assembles and delivers the file',
      segmentedRecord?.status === 'completed' &&
        segmentedRecord?.kind === 'segmented' &&
        segmentedRecord?.segments?.length >= 2 &&
        segmentedRecord?.segments?.every((segment) => segment.status === 'completed') &&
        segmentedRecord?.downloadedBytes === local.segmentedSize &&
        segmentedFileSize === local.segmentedSize,
      segmentedRecord
        ? `status=${segmentedRecord.status}, kind=${segmentedRecord.kind}, segments=${segmentedRecord.segments?.length}, bytes=${segmentedRecord.downloadedBytes}/${local.segmentedSize}, file=${segmentedFileSize}, name=${segmentedRecord.filename}, delivery=${segmentedRecord.deliveryFilename ?? 'n/a'}, path=${publicPath(segmentedRecord.outputPath)}, chromeId=${segmentedRecord.chromeDownloadId ?? 'n/a'}, tree=[${downloadTree.join(', ')}]${segmentedRecord.fallbackReason ? `, fallback=${segmentedRecord.fallbackReason}` : ''}`
        : 'segmented download did not finish',
    );

    if (segmentedId && segmentedRecord?.chromeDownloadId) {
      await helpers
        .evaluate(
          `Promise.all([
            chrome.downloads.removeFile(${segmentedRecord.chromeDownloadId}).catch(() => undefined),
            chrome.downloads.erase({ id: ${segmentedRecord.chromeDownloadId} }).catch(() => undefined)
          ]).then(() => true)`,
        )
        .catch(() => undefined);
    }
    if (segmentedId) await helpers.request({ type: 'downloads:remove', id: segmentedId });
  } finally {
    await local.close();
  }

  const passed = checks.filter((check) => check.passed).length;
  const success = passed === checks.length && checks.length > 0;
  const text = [
    '# DownFlow browser smoke report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Browser: ${version.Browser}`,
    '',
    `Extension: ${extension.name} (${extension.id}, ${extension.location})`,
    '',
    `Result: ${success ? 'PASS' : 'FAIL'} - ${passed}/${checks.length} checks passed`,
    '',
    '| Check | Result | Detail |',
    '| --- | --- | --- |',
    ...checks.map(
      (check) =>
        `| ${check.name} | ${check.passed ? 'PASS' : 'FAIL'} | ${String(check.detail).replaceAll('|', '\\|')} |`,
    ),
    '',
    '## Scope',
    '',
    'This test loads the production `dist/` build into a real Chromium browser and exercises',
    'the popup, dashboard, background message API, scheduler persistence, settings persistence,',
    'a native Chrome Downloads transfer, and a full segmented Range/OPFS transfer (probe,',
    'concurrent segments, assembly, and file delivery) against a local HTTP server.',
    '',
    'It does not replace the manual checklist in `docs/CHROME_VERIFICATION.md`. Site detection,',
    'media capture, HLS/DASH assembly, service-worker suspension, and Chrome restart recovery',
    'still need a real browsing session to verify end to end.',
    '',
    ...(attempts.length
      ? ['## Browser attempts', '', ...attempts.map((attempt) => `- ${attempt.browserPath}: ${attempt.result}`), '']
      : []),
  ].join('\n');
  writeFileSync(reportPath, text, 'utf8');
  console.log(`\nWrote ${reportPath} (${passed}/${checks.length} checks passed).`);

  browser.close();
  page.close();
  await cleanup();
  process.exit(success ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
