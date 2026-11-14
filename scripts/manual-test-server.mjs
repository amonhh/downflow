#!/usr/bin/env node
/**
 * Local verification server for DownFlow.
 *
 * Serves an HTML page with downloadable links, HTTP Range responses, a
 * no-Range endpoint (for fallback testing), authentication/expired endpoints,
 * an HLS playlist and a DASH manifest. No dependencies and no internet access.
 *
 * Usage:
 *   node scripts/manual-test-server.mjs [port]
 *   npm run test:server
 *
 * Then open http://127.0.0.1:4310/ in Chrome with DownFlow loaded. Open the
 * dashboard's Video and Audio page after clicking the media links.
 */
import { createServer } from 'node:http';

const port = Number(process.argv[2] || process.env.DOWNFLOW_TEST_PORT || 4310);
const host = '127.0.0.1';
const base = `http://${host}:${port}`;

function makeBytes(size, seed) {
  const buffer = Buffer.alloc(size);
  let value = seed;
  for (let index = 0; index < size; index++) {
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    buffer[index] = value & 0xff;
  }
  return buffer;
}

const files = {
  '/files/sample.pdf': { body: makeBytes(3 * 1024 * 1024, 7), type: 'application/pdf', name: 'sample.pdf' },
  '/files/archive.zip': { body: makeBytes(5 * 1024 * 1024, 11), type: 'application/zip', name: 'archive.zip' },
  '/files/photo.png': { body: makeBytes(256 * 1024, 13), type: 'image/png', name: 'photo.png' },
  '/files/clip.mp4': { body: makeBytes(1024 * 1024, 17), type: 'video/mp4', name: 'clip.mp4' },
  '/files/tone.mp3': { body: makeBytes(512 * 1024, 19), type: 'audio/mpeg', name: 'tone.mp3' },
  '/files/notes.txt': { body: makeBytes(128 * 1024, 23), type: 'text/plain', name: 'notes.txt' },
  '/no-range/big.bin': { body: makeBytes(3 * 1024 * 1024, 29), type: 'application/octet-stream', name: 'big.bin' },
  '/expired/report.pdf': { body: makeBytes(64 * 1024, 31), type: 'application/pdf', name: 'report.pdf' },
  '/auth/protected.pdf': { body: makeBytes(64 * 1024, 37), type: 'application/pdf', name: 'protected.pdf' },
};

const hlsSegments = [0, 1, 2].map((index) => makeBytes(128 * 1024, 41 + index));
const dashSegments = [1, 2, 3, 4, 5, 6].map((index) => makeBytes(96 * 1024, 53 + index));
const dashInit = makeBytes(16 * 1024, 61);

const hlsPlaylist = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:1',
  '#EXT-X-MEDIA-SEQUENCE:0',
  '#EXTINF:1.0,',
  'seg-0.ts',
  '#EXTINF:1.0,',
  'seg-1.ts',
  '#EXTINF:1.0,',
  'seg-2.ts',
  '#EXT-X-ENDLIST',
  '',
].join('\n');

const dashManifest = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT30S" minBufferTime="PT2S">
  <Period duration="PT30S">
    <AdaptationSet mimeType="video/mp4" contentType="video" segmentAlignment="true">
      <SegmentTemplate timescale="1000" duration="5000" startNumber="1"
        initialization="init-$RepresentationID$.mp4"
        media="segment-$Number$.m4s" />
      <Representation id="v1" bandwidth="800000" width="640" height="360" codecs="avc1.4d401e" />
    </AdaptationSet>
  </Period>
</MPD>`;

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>DownFlow local test page</title>
<style>
  body { background:#0b1220; color:#e6edf7; font-family: Segoe UI, sans-serif; padding:40px; max-width:900px; }
  h1 { color:#60a5fa; } h2 { margin-top:32px; border-bottom:1px solid #24314a; padding-bottom:6px; }
  a { color:#93c5fd; } code { background:#16233a; padding:2px 6px; border-radius:4px; }
  li { margin:8px 0; } .note { color:#9fb0c9; }
</style>
</head>
<body>
<h1>DownFlow local verification page</h1>
<p class="note">Served from <code>${base}</code>. Files support HTTP Range requests unless marked otherwise.</p>

<h2>Detectable file links</h2>
<ul>
  <li><a href="/files/sample.pdf">sample.pdf (3 MB, Range supported)</a></li>
  <li><a href="/files/archive.zip">archive.zip (5 MB, Range supported)</a></li>
  <li><a href="/files/photo.png">photo.png (256 KB)</a></li>
  <li><a href="/files/notes.txt">notes.txt (128 KB)</a></li>
</ul>

<h2>Segmented fallback and errors</h2>
<ul>
  <li><a href="/no-range/big.bin">big.bin on a server that ignores Range (expect Standard mode)</a></li>
  <li><a href="/expired/report.pdf">expired link (expect HTTP 410 and a failed download)</a></li>
  <li><a href="/auth/protected.pdf">authentication required (expect HTTP 401)</a></li>
</ul>

<h2>Direct media</h2>
<ul>
  <li><a href="/files/clip.mp4">clip.mp4 (video)</a></li>
  <li><a href="/files/tone.mp3">tone.mp3 (audio)</a></li>
</ul>
<video controls width="320" src="/files/clip.mp4"></video>
<audio controls src="/files/tone.mp3"></audio>

<h2>HLS and DASH</h2>
<ul>
  <li><a href="/hls/demo.m3u8">HLS playlist (unencrypted, 3 segments)</a></li>
  <li><a href="/dash/demo.mpd">DASH manifest (unencrypted, 6 segments)</a></li>
</ul>
<p class="note">The media segments are deterministic test bytes, not playable video. They verify detection, segment download and assembly.</p>
</body>
</html>`;

function sendBuffer(request, response, body, type, name, allowRange = true) {
  const range = allowRange ? request.headers.range : undefined;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match) {
      let start = match[1] === '' ? body.length - Number(match[2]) : Number(match[1]);
      let end = match[2] === '' || match[1] === '' ? body.length - 1 : Number(match[2]);
      if (!Number.isFinite(start) || start < 0) start = 0;
      if (!Number.isFinite(end) || end >= body.length) end = body.length - 1;
      if (start > end) {
        response.writeHead(416, { 'Content-Range': `bytes */${body.length}` });
        response.end();
        return;
      }
      const chunk = body.subarray(start, end + 1);
      response.writeHead(206, {
        'Content-Type': type,
        'Content-Length': chunk.length,
        'Content-Range': `bytes ${start}-${end}/${body.length}`,
        'Accept-Ranges': 'bytes',
        'Content-Disposition': `attachment; filename="${name}"`,
      });
      response.end(request.method === 'HEAD' ? undefined : chunk);
      return;
    }
  }
  response.writeHead(200, {
    'Content-Type': type,
    'Content-Length': body.length,
    'Accept-Ranges': allowRange ? 'bytes' : 'none',
    'Content-Disposition': `attachment; filename="${name}"`,
  });
  response.end(request.method === 'HEAD' ? undefined : body);
}

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', base);
  const pathname = url.pathname;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method not allowed');
    return;
  }

  if (pathname === '/' || pathname === '/index.html') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(request.method === 'HEAD' ? undefined : page);
    return;
  }

  const file = files[pathname];
  if (file) {
    if (pathname.startsWith('/expired/')) {
      response.writeHead(410, { 'Content-Type': 'text/plain' });
      response.end('This link has expired.');
      return;
    }
    if (pathname.startsWith('/auth/')) {
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="DownFlow test"' });
      response.end('Authentication required.');
      return;
    }
    sendBuffer(request, response, file.body, file.type, file.name, !pathname.startsWith('/no-range/'));
    return;
  }

  if (pathname === '/hls/demo.m3u8') {
    const body = Buffer.from(hlsPlaylist, 'utf8');
    response.writeHead(200, {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Content-Length': body.length,
      'Accept-Ranges': 'bytes',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
    return;
  }

  const hlsMatch = /^\/hls\/seg-(\d+)\.ts$/.exec(pathname);
  if (hlsMatch) {
    const index = Number(hlsMatch[1]);
    const body = hlsSegments[index];
    if (!body) {
      response.writeHead(404);
      response.end();
      return;
    }
    sendBuffer(request, response, body, 'video/mp2t', `seg-${index}.ts`, true);
    return;
  }

  if (pathname === '/dash/demo.mpd') {
    const body = Buffer.from(dashManifest, 'utf8');
    response.writeHead(200, {
      'Content-Type': 'application/dash+xml',
      'Content-Length': body.length,
      'Accept-Ranges': 'bytes',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
    return;
  }

  if (pathname === '/dash/init-v1.mp4') {
    sendBuffer(request, response, dashInit, 'video/mp4', 'init-v1.mp4', true);
    return;
  }

  const dashMatch = /^\/dash\/segment-(\d+)\.m4s$/.exec(pathname);
  if (dashMatch) {
    const index = Number(dashMatch[1]);
    const body = dashSegments[index - 1];
    if (!body) {
      response.writeHead(404);
      response.end();
      return;
    }
    sendBuffer(request, response, body, 'video/mp4', `segment-${index}.m4s`, true);
    return;
  }

  response.writeHead(404, { 'Content-Type': 'text/plain' });
  response.end('Not found');
});

server.listen(port, host, () => {
  console.log(`DownFlow manual test server running at ${base}/`);
  console.log('Open the page in Chrome with the DownFlow extension loaded.');
  console.log('Press Ctrl+C to stop.');
});
