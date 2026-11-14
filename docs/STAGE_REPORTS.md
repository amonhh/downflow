# DownFlow stage completion report

This report describes what was built in each stage, how it was verified, and what
is honestly **not** covered. It is not a marketing summary: every "verified" line
refers to a command or file that exists in this repository.

Project root: `C:\path\to\downflow`
Build target: Chrome MV3 extension (React + TypeScript + Vite)
Reference toolchain: Node.js 24.22.1, npm 11.19.1, Vitest 5.0.5, Vite 6.4.5

---

## Summary of final evidence

| Check | Result | Source |
| --- | --- | --- |
| Production build + artifact verification | Pass | `npm run build` → `DownFlow build verification passed.` |
| TypeScript project check | Pass | `tsc --noEmit` (runs inside `npm run build`) |
| Unit/integration tests | 168/168 pass, 22 files | `npm test`, `TEST_REPORT.md` |
| Dependency audit | 0 vulnerabilities | `npm audit` |
| Real-browser smoke test | 15/15 checks | `npm run smoke:browser`, `BROWSER_SMOKE_REPORT.md` |
| Manual in-browser checklist | **Not run** | `docs/CHROME_VERIFICATION.md` |

The smoke test used Microsoft Edge 156 (Chromium) because the installed branded
Google Chrome 156 ignored `--load-extension` in headless mode. Loading the
extension through `chrome://extensions` is unaffected.

---

## Stage 1 — Scaffold, toolchain and MV3 shell

**Goal:** a buildable extension shell with no runtime backend.

**Delivered**

- Vite + React + TypeScript project with separate configs for the extension pages
  and the content script (`vite.config.ts`, `vite.content.config.ts`,
  `vitest.config.ts`, `tsconfig.json`).
- MV3 manifest (`public/manifest.json`) declaring the service worker, action
  popup, options page, side panel, content script and minimal justified
  permissions.
- HTML entries: `popup.html`, `dashboard.html`, `options.html`, `offscreen.html`.
- Generated PNG icons (`scripts/generate-icons.mjs`).
- Build verification (`scripts/verify-build.mjs`) that fails if any required
  artifact is missing, plus `scripts/clean.mjs`.
- `.gitignore` that keeps `dist/` and reports out of version control while
  committing the generated evidence reports.

**Verification**

- `npm run build` produces `dist/` with manifest, icons, all HTML pages, content
  script and `background/service-worker.js`, then prints the verification pass.

**Limitations**

- Requires Node.js only for building; the loaded extension has no Node runtime.
- Branded Chrome builds can refuse command-line extension loading. This affects
  only automated launching, not normal manual loading.

---

## Stage 2 — Shared domain layer and persistent storage

**Goal:** one source of truth for records, settings and derived data.

**Delivered**

- `src/shared/types.ts`: download records and statuses (`queued`, `probing`,
  `downloading`, `paused`, `delivering`, `completed`, `failed`, `cancelled`),
  engines (`standard`, `segmented`, `hls`, `dash`), sources, categories, media
  resources, schedules, settings and message types.
- `src/shared/constants.ts`: extension→category maps and defaults (4 connections,
  2 MiB minimum segment, memory limit, retry defaults).
- `src/shared/utilities.ts`: filename/folder sanitisation (Windows reserved
  names, control characters, length limits), download path building, URL
  validation, byte/speed/duration formatting.
- `src/shared/detection.ts`, `src/shared/stats.ts`, `src/shared/scheduler.ts`,
  `src/shared/messaging.ts`.
- IndexedDB schema and stores (`src/storage/database.ts`,
  `downloads-store.ts`, `media-store.ts`, `segment-storage.ts`).
- `src/storage/settings-store.ts`: normalised settings, queue state and schedules
  in `chrome.storage.local` with change subscription and defaults migration.

**Verification**

- `tests/utilities.test.ts`, `tests/settings-store.test.ts`,
  `tests/downloads-store.test.ts`, `tests/media-store.test.ts`,
  `tests/stats.test.ts`, `tests/scheduler-shared.test.ts` all pass.
- Stores are exercised against `fake-indexeddb` and a stateful Chrome API mock,
  not ad-hoc stubs.

**Limitations**

- No cloud sync: records live in the browser profile and disappear if extension
  data is cleared.

---

## Stage 3 — Standard engine (Chrome Downloads API)

**Goal:** reliable native downloads that stay in sync with Chrome.

**Delivered**

- `src/engine/standard-engine.ts`: start/pause/resume/cancel/open/show wrappers,
  Chrome state→record status mapping, path building and duplicate policy.
- Native event synchronisation in the coordinator: downloads started by DownFlow
  and by Chrome itself are adopted into the dashboard, with progress, speed,
  ETA, completion and error mapping.
- Human-readable mapping of Chrome error codes (`SERVER_UNAUTHORIZED`,
  `FILE_NO_SPACE`, `NETWORK_DISCONNECTED`, `USER_CANCELED`, etc.).

**Verification**

- `tests/standard-engine.test.ts` covers state mapping and start options.
- `tests/coordinator.test.ts` covers adoption, progress and terminal transitions.
- Real-browser smoke test starts a native download and confirms the file is
  written with the expected byte count (`131072/131072`, `files=1`).

**Limitations**

- Chrome's Downloads API exposes no throttling for standard transfers, so
  bandwidth limits do not apply to them. The README and troubleshooting guide say
  so explicitly.
- Chrome controls the save prompt and protected folders.

---

## Stage 4 — Segmented Range/OPFS engine

**Goal:** a real multi-connection engine with validation and safe fallback.

**Delivered**

- `src/engine/range-validator.ts`: probes `Accept-Ranges`/`Content-Length`/`206`
  and validates `Content-Range`, total size, ETag and Last-Modified consistency.
- `src/engine/file-assembler.ts`: segment planning, ordered assembly, final size
  verification, per-segment metadata.
- `src/engine/segmented-engine.ts`: concurrent Range requests, per-segment
  progress and errors, pause/cancel signals, persistent segment metadata.
- `src/storage/segment-storage.ts`: OPFS-backed segment files with cleanup.
- `src/engine/retry-manager.ts`: bounded retries with backoff.
- `src/engine/bandwidth-limiter.ts`: token-bucket global/per-transfer limiting.
- Honest fallback: when Range is unsupported or unsafe, size is missing, validators
  change, the file is below the minimum segment size, or the memory limit is
  exceeded, the coordinator switches to the standard engine and records
  `fallbackReason` (shown as a **Standard mode** chip).
- File size limits: `MIN_SEGMENT_SIZE = 2 MiB`; `memoryLimitMb` default 512 MB.

**Verification**

- `tests/range-validator.test.ts`, `tests/file-assembler.test.ts`,
  `tests/segmented-engine.test.ts`, `tests/segment-storage.test.ts`,
  `tests/retry-manager.test.ts`, `tests/bandwidth-limiter.test.ts` pass.
- Engine tests run against a real local HTTP server with actual Range responses.
- Browser smoke test performs a full 5 MiB / 2-segment transfer: probe,
  concurrent segments, OPFS assembly, size verification, and file delivery with
  the correct filename and exact byte count.

**Limitations**

- Segmented delivery uses a hidden blob link because Chrome ignores `filename` for
  `blob:` URLs. This preserves the filename but saves to Chrome's default download
  folder; category-folder routing applies to standard downloads only.
- Servers that throttle, reject concurrency, or change validators intentionally
  fall back rather than being forced.
- The default 512 MB memory ceiling bounds very large segmented files; larger
  files use standard mode.

---

## Stage 5 — Queue, scheduler and coordinator

**Goal:** ordered, persistent, resumable download orchestration.

**Delivered**

- `src/queue/queue-manager.ts`: priority, queue ordering, next-candidate
  selection, pause/resume, reordering.
- `src/background/coordinator.ts`: the single state machine — start, pause,
  resume, cancel, retry, auto-retry, reorder, concurrency pump, native sync,
  delivery watchdog, startup recovery, history clearing, badge updates.
- `src/background/scheduler.ts`: one-off and daily jobs via `chrome.alarms`,
  action `start-queue`/`pause-all`, `maxDownloads`, next-run calculation,
  create/update/delete/enable.
- `src/background/service-worker.ts`: typed message router, context menus,
  alarms, notification plumbing, install/startup recovery.
- `src/background/offscreen-manager.ts`: offscreen lifecycle and messaging.

**Verification**

- `tests/queue-manager.test.ts`, `tests/coordinator.test.ts`,
  `tests/scheduler-background.test.ts`, `tests/scheduler-shared.test.ts` pass.
- Smoke test creates and deletes a schedule through the real background API and
  confirms settings write persistence across calls.
- Browser smoke test confirms the coordinator accepts a segmented download and
  drives it to completion.

**Limitations**

- Schedules cannot fire while Chrome is fully closed. System sleep can delay
  alarms.
- Standard Chrome downloads are not throttled (platform limitation).

---

## Stage 6 — Detection, content script and context menus

**Goal:** discover downloadable files without silently capturing everything.

**Delivered**

- `src/content/detector.ts`: link/click/navigation and MIME/extension detection
  for the required document, archive, software, image, audio and video types.
- `src/content/media-detector.ts`: media element and network response
  observation.
- `src/content/overlay.ts`: in-page prompt with **Download with DownFlow** and
  **Download normally**.
- `src/content/index.ts`: bootstrap and message wiring.
- Context menus: **Download with DownFlow**, **Add to queue**, **Copy download
  link**.
- Detection is user-confirmed; no silent downloads.

**Verification**

- `tests/detection.test.ts` covers extension/MIME classification and link
  heuristics.
- The local test server (`npm run test:server`) provides real pages and files to
  exercise detection manually.

**Limitations**

- Content scripts cannot run on `chrome://`, the Chrome Web Store, or other
  restricted pages.
- JavaScript-generated `blob:` downloads and some site handlers cannot be
  intercepted.
- Strict site CSPs can interfere with the overlay; the context menu is the
  reliable fallback.
- In-page detection and context menus are **not** covered by the automated
  browser smoke test; use `docs/CHROME_VERIFICATION.md`.

---

## Stage 7 — Media, HLS and DASH

**Goal:** detect and assemble accessible media without DRM circumvention.

**Delivered**

- `src/media/hls-detector.ts`: playlist parsing, variant and segment resolution.
- `src/media/dash-detector.ts`: MPD parsing for `SegmentTemplate`/`SegmentList`,
  representations, init segments and durations; rejects live/dynamic manifests.
- `src/media/media-engine.ts`: ordered segment download, concatenation, size
  accounting and abort support.
- `src/background/media-discovery.ts`: capture, probing, persistence to the media
  store, protection flags.
- Dashboard **Video & audio** page to list and start media downloads.
- A format/quality picker for multi-variant HLS playlists and multi-representation
  DASH manifests. Variants are sorted best-first, the highest is preselected and
  marked **Best**, and DASH makes clear that video/audio tracks are not merged.
- Encryption/DRM is detected and refused, not bypassed.

**Verification**

- `tests/hls-detector.test.ts`, `tests/dash-detector.test.ts`,
  `tests/media-engine.test.ts`, `tests/media-store.test.ts` pass.
- The local server exposes a 3-segment HLS playlist and a 6-segment DASH manifest
  with real Range responses for manual verification.
- The quality picker was exercised in a real Edge 156 session with a local
  three-variant HLS master playlist. It listed 1080p/720p/360p best-first,
  preselected 1080p, showed exactly one **Best** badge, and changed the selection
  to 720p when clicked. The card's variant dropdown matched the modal.

**Limitations**

- HLS output is concatenated media segments; it is not remuxed into every
  container.
- DASH supports accessible non-DRM `SegmentTemplate`/`SegmentList`; separate
  audio/video tracks are not merged.
- DRM/encrypted streams are intentionally unsupported.
- Live streams (`type="dynamic"`) are rejected.
- Media capture and HLS/DASH assembly are **not** covered by the automated
  browser smoke test; the test manifests contain deterministic dummy bytes and
  prove the pipeline, not codec correctness.

---

## Stage 8 — Offscreen transfer host and delivery

**Goal:** run long transfers and assembly outside the MV3 service worker.

**Delivered**

- `src/offscreen/offscreen.ts`: segmented and media job hosting, OPFS assembly,
  progress/complete/error reporting, clipboard fallback, delivery blob registry
  and redelivery.
- Offscreen settings are fetched from the background over `runtime` messages
  (`settings:get`) and refreshed via `offscreen:sync-settings`, because
  `chrome.storage` is not available in this context.
- Blob delivery via a hidden `<a download>` click to preserve the real filename.
- Background delivery watchdog (`DELIVERY_WATCHDOG_MS = 60s`) and stale-delivery
  recovery on startup (`DELIVERY_STALE_MS = 2 min`).
- Retry can re-deliver an already assembled blob (`offscreen:redeliver`) without
  re-downloading.

**Verification**

- The browser smoke test proves the offscreen path end to end (5 MiB, 2 segments,
  correct filename and size).
- Delivery and watchdog behaviour is covered indirectly by coordinator tests and
  observed in the smoke run.

**Limitations**

- Offscreen documents only expose a subset of extension APIs here
  (`chrome.runtime`); settings access was redesigned around that constraint.
- Chrome saves blob-link deliveries to the default folder with a sanitised
  filename (`/` and `\` become `_`).
- If the assembled blob is gone after a restart, retry starts a fresh transfer.

---

## Stage 9 — Popup, dashboard and options UI

**Goal:** a complete, usable interface for every required section.

**Delivered**

- `src/popup/`: compact popup with active downloads, speed, quick actions, media,
  scheduler and dashboard shortcuts.
- `src/dashboard/App.tsx` and pages:
  - Overview
  - All downloads
  - Downloading
  - Queued
  - Completed
  - Paused
  - Failed
  - Video & audio
  - Categories
  - Statistics
  - Scheduler
  - Settings
- Download cards with file tile/extension, source domain, size, transferred bytes,
  percentage, speed, ETA, status, and only supported actions (pause, resume,
  cancel, retry, open, show in folder, copy URL, remove).
- Search, filter and sort by name/source, category, status, date, size and name.
- Settings for folders, categorisation, concurrency, connections, segmentation,
  retries, detection toggles, bandwidth, memory limit, history, duplicate policy,
  theme.
- Categories and statistics pages derived from stored records.
- Options page.
- Shared React components, theme and styles under `src/ui/`.

**Verification**

- Smoke test: popup renders without runtime errors; dashboard exposes all primary
  navigation labels; stats endpoint derives from stored records.
- Build verification confirms all HTML/JS/CSS artifacts exist.

**Limitations**

- Visual polish and accessibility were implemented but not formally audited.
- Some UI states depend on real downloads; the smoke test seeds a minimal history.

---

## Stage 10 — Testing, hardening and documentation

**Goal:** prove the implementation and document it honestly.

**Delivered**

- 22 Vitest suites (168 tests) covering: bandwidth limiter, coordinator, DASH
  detection, content detection, downloads store, file assembler, HLS detection,
  media engine, media store, queue manager, range validator, retry manager,
  background scheduler, shared scheduler, segment storage, segmented engine,
  settings store, standard engine, statistics, utilities, site-format ranking and
  native-port lifecycle.
- Tests use a real local HTTP server for Range/segmented behaviour,
  `fake-indexeddb` for storage, and a stateful Chrome API mock — not silent
  no-op mocks.
- `scripts/test-report.mjs` generates `TEST_REPORT.md` from real Vitest JSON.
- `scripts/smoke-extension.mjs` loads the production `dist/` into a real Chromium
  browser and runs 15 checks, writing `BROWSER_SMOKE_REPORT.md`.
- `scripts/manual-test-server.mjs` (`npm run test:server`) serves Range files, a
  no-Range endpoint, 410/401 error routes, an HLS playlist and a DASH manifest.
- Documentation: `README.md`, `docs/WINDOWS_INSTALL.md`,
  `docs/TROUBLESHOOTING.md`, `docs/CHROME_VERIFICATION.md`, this report.
- Hardening from real-browser findings:
  - Fixed an offscreen crash caused by touching `chrome.storage` in a context
    where it is undefined.
  - Replaced ineffective `onDeterminingFilename` handling with anchor-based blob
    delivery.
  - Added a stalled-delivery watchdog and redelivery path.
  - Made startup recovery distinguish resumable transfers from abandoned
    deliveries.

**Verification**

- `npm run build` — pass.
- `npm test` — 168/168 pass.
- `npm run test:report` — regenerates `TEST_REPORT.md` (168/168, 0 failed).
- `npm audit --audit-level=low` — 0 vulnerabilities.
- `npm run smoke:browser` — 15/15 pass in Edge 156, including native and
  segmented transfers.
- Manual test server endpoints verified with a Range-capable client:
  root 200, Range 206 with `Content-Range`, no-Range 200 with
  `Accept-Ranges: none`, expired 410, auth 401, HLS 200 with 3 segments, HLS
  segment 206, DASH 200 with `SegmentTemplate`, DASH segment 206, missing 404.

**Limitations / not claimed**

- Manual verification of in-page detection, context menus, live media capture,
  HLS/DASH assembly in a real player, service-worker suspension and Chrome
  restart recovery has **not** been performed. The checklist exists to do it.
- No universal interception or guaranteed acceleration is claimed.
- DRM bypass is explicitly out of scope.
- Segmented category-folder routing is not available due to Chrome's blob-URL
  filename limitation.

---

## Post-completion hardening — filename and extension resolution

**Problem observed:** media and page titles were being passed through as filenames
without an extension, so a video titled by its page could be saved with no
extension. Separately, the browser smoke harness uses CDP
`Browser.setDownloadBehavior`, which makes Chrome derive the name from the URL and
ignore the requested filename; that test-only behaviour was initially mistaken for
a product bug.

**Delivered**

- `resolveDownloadFilename` in `src/shared/utilities.ts` resolves each file from its
  own metadata: explicit user name → `Content-Disposition` → page/media title →
  URL basename → fallback.
- `ensureFilenameExtension` adds an extension from the URL, MIME type or media kind
  when the chosen name has none, and corrects a clearly conflicting extension such
  as `.exe` on a video/PDF/archive response.
- Applied in `startDownload`, direct media downloads, HLS/DASH record creation,
  segmented-probe filename updates, and link detection.
- `makeMediaResource` now falls back to the page title when a detected media item
  has no explicit title.
- `pageDownloadHint` and `isDirectFileUrl` in `src/shared/utilities.ts` reject
  video/audio page URLs (YouTube, Vimeo, TikTok, Instagram, X, Twitch, etc.) and
  page-shaped paths such as `/watch`, `/shorts`, `/video`, `/reel` and `/live`
  before a download starts. Direct files, HLS/DASH manifests and media CDNs are
  still allowed.
- A backstop in `applyNativeItems` discards a completed response when Chrome
  reports `text/html` and neither the URL nor the chosen filename has an
  `.html`/`.htm` extension. The file is removed from disk and the record is marked
  failed with `NOT_A_FILE` instead of silently keeping a page.
- 15 new unit tests cover filename resolution, media titles, page-URL rejection,
  direct-file acceptance and the HTML-page detector (168 tests total).

**Live online verification (no CDP download override):** four separate internet
downloads produced four separate, correct names:

| Input | Saved name |
| --- | --- |
| MP4 URL, title `Ocean Waves at Sunset - YouTube` | `Ocean Waves at Sunset.mp4` |
| Text URL, title `Annual Report 2026` | `Annual Report 2026.txt` |
| Binary URL, title `Holiday Photos Backup`, ZIP MIME | `Holiday Photos Backup.zip` |
| Media detection, page title `Guitar Practice Session - YouTube` | `Guitar Practice Session.mp4` |

Chrome 156 was also confirmed to honour the extension-supplied `filename` even
when the server sends its own `Content-Disposition`.

**Live page-URL verification:** with the extension reloaded in Edge 156:

| Case | Result |
| --- | --- |
| `https://www.youtube.com/watch?v=...` | rejected before download with the Video & Audio guidance |
| `https://httpbin.org/html` (HTML, no file extension) | completed as HTML, then discarded; record `failed` / `NOT_A_FILE`, file absent from disk |
| `https://download.samplelib.com/mp4/sample-10s.mp4` with title `Ocean Waves at Sunset - YouTube` | `Ocean Waves at Sunset.mp4`, 5,485,935 / 5,485,935 bytes |

YouTube itself could not be downloaded by the extension-only design at this stage:
it serves MSE/blob streams and protected content, and DownFlow does not bypass
those protections. Page URLs were refused with an explanation instead of saving
`watch`. **Superseded later by the optional native helper — see the correction at
the end of this report.**

**Not claimed**

- The reported `.exe` symptom was not reproduced from the current source. If it
  recurs, the exact URL/site is required to identify whether the remote response
  really is an executable. A genuine executable response still keeps `.exe`; only
  an extension that clearly conflicts with the URL/MIME type is corrected.
- Filename checks must be read from `chrome.downloads.search(...).filename`, not
  from a CDP-redirected download folder.

---

## Post-completion hardening — media quality picker and YouTube evidence

**Request:** when a page offers several video qualities or formats, prompt the
user with a simple choice before downloading.

**Delivered**

- `src/dashboard/pages/MediaPage.tsx` now ranks HLS variants and DASH
  representations best-first by resolution and bandwidth, preselects the highest,
  and marks it **Best**.
- Pressing **Download** with more than one option opens a
  **Choose format & quality** modal with keyboard-accessible radio options.
  Pressing it with one option downloads immediately.
- The modal explains that DASH video and audio are separate tracks and that HLS
  segments are concatenated into `.ts` (or `.mp4` for fMP4 playlists).
- The existing card dropdown remains available, and both controls share the same
  selection.

**Real-browser verification (Edge 156, built `dist/`):** a local HLS master
playlist exposed 360p, 720p and 1080p variants. The card and modal listed:

```text
1080p · 1920x1080 · 5200 kbps   [Best, selected]
720p  · 1280x720  · 2400 kbps
360p  · 640x360   · 800 kbps
```

Clicking the 720p row moved the selection to 720p. Result: **pass**.

**YouTube investigation (November 2026, live extension):**

| Probe | Result |
| --- | --- |
| Watch page fetch | HTTP 200, `playabilityStatus: OK`, title and 27 formats present |
| Adaptive formats | no `url` field on any video/audio format |
| Muxed 360p (`itag 18`) | only a `signatureCipher`, not a usable URL |
| `hlsManifestUrl` / `dashManifestUrl` | absent |
| `streamingData` keys | `expiresInSeconds`, `formats`, `adaptiveFormats`, `serverAbrStreamingUrl` |
| InnerTube `/youtubei/v1/player` (WEB, Android, iOS, embedded, VR, MWEB) | HTTP 403 “Sorry…” |

YouTube therefore cannot be downloaded by an extension-only design without
implementing signature deciphering, PoToken/SABR, and separate audio/video
muxing. The Seal desktop app succeeds because it is a native application that
drives yt-dlp/FFmpeg.

**Correction — optional native helper (November 2026):** the project later added
an explicitly installed, local-only native-messaging helper that runs yt-dlp. This
is not remote code, is not bundled with the extension, and is not installed
automatically. With the helper installed, DownFlow probes video pages and offers
their real formats; without it, YouTube page URLs are still refused instead of
saving an HTML file. See [VIDEO_SITES.md](VIDEO_SITES.md). Verified in Edge with
the unpacked extension: YouTube probe returned 24 raw formats, an audio-only
download completed to a valid `.m4a`, and after installing FFmpeg through the
helper installer, a video-only format merged with audio into a 252,182-byte MP4
containing H.264 video and Opus audio.

---

## File inventory (primary)

| Area | Files |
| --- | --- |
| Manifest / entries | `public/manifest.json`, `popup.html`, `dashboard.html`, `options.html`, `offscreen.html` |
| Background | `src/background/{service-worker,coordinator,scheduler,media-discovery,offscreen-manager}.ts` |
| Content | `src/content/{detector,media-detector,overlay,index}.ts` |
| Engines | `src/engine/{standard-engine,segmented-engine,range-validator,file-assembler,bandwidth-limiter,retry-manager,engine-errors}.ts` |
| Media | `src/media/{hls-detector,dash-detector,media-engine}.ts` |
| Storage | `src/storage/{database,downloads-store,media-store,segment-storage,settings-store}.ts` |
| Queue | `src/queue/queue-manager.ts` |
| Shared | `src/shared/{types,constants,detection,stats,scheduler,utilities,messaging}.ts` |
| UI | `src/ui/*`, `src/popup/*`, `src/dashboard/*`, `src/offscreen/offscreen.ts` |
| Tests | `tests/*.test.ts` (20 suites) |
| Scripts | `scripts/{generate-icons,verify-build,test-report,smoke-extension,manual-test-server,clean}.mjs` |
| Docs | `README.md`, `docs/{WINDOWS_INSTALL,TROUBLESHOOTING,CHROME_VERIFICATION,STAGE_REPORTS}.md` |
| Evidence | `TEST_REPORT.md`, `BROWSER_SMOKE_REPORT.md` |
