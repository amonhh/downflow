# DownFlow automated test report

Generated: 2026-11-13 08:36:09 UTC

This report was generated from a real `vitest run --reporter=json` execution.
It is not hand-written and no test results are simulated.

## Environment

- Node.js: v24.22.1
- Vitest: 5.0.5
- Browser APIs: Node `fetch`/`Blob` with a real local HTTP server, `fake-indexeddb`, and a stateful Chrome API mock

## Summary

| Metric | Result |
| --- | --- |
| Status | PASS |
| Test files | 22 |
| Tests | 168 |
| Passed | 168 |
| Failed | 0 |
| Skipped | 0 |
| Test time | 1.75s |
| Wall time | 4.00s |

## Suites

| Test file | Tests | Passed | Failed | Duration |
| --- | ---: | ---: | ---: | ---: |
| `tests/bandwidth-limiter.test.ts` | 6 | 6 | 0 | 0.37s |
| `tests/coordinator.test.ts` | 10 | 10 | 0 | 0.28s |
| `tests/dash-detector.test.ts` | 7 | 7 | 0 | 0.03s |
| `tests/detection.test.ts` | 11 | 11 | 0 | 0.03s |
| `tests/downloads-store.test.ts` | 6 | 6 | 0 | 0.05s |
| `tests/file-assembler.test.ts` | 7 | 7 | 0 | 0.02s |
| `tests/hls-detector.test.ts` | 7 | 7 | 0 | 0.02s |
| `tests/media-engine.test.ts` | 4 | 4 | 0 | 0.17s |
| `tests/media-store.test.ts` | 4 | 4 | 0 | 0.04s |
| `tests/queue-manager.test.ts` | 7 | 7 | 0 | 0.01s |
| `tests/range-validator.test.ts` | 12 | 12 | 0 | 0.16s |
| `tests/retry-manager.test.ts` | 8 | 8 | 0 | 0.09s |
| `tests/scheduler-background.test.ts` | 7 | 7 | 0 | 0.04s |
| `tests/scheduler-shared.test.ts` | 7 | 7 | 0 | 0.01s |
| `tests/segment-storage.test.ts` | 6 | 6 | 0 | 0.01s |
| `tests/segmented-engine.test.ts` | 4 | 4 | 0 | 0.32s |
| `tests/settings-store.test.ts` | 7 | 7 | 0 | 0.02s |
| `tests/site-formats.test.ts` | 7 | 7 | 0 | 0.02s |
| `tests/site-helper.test.ts` | 2 | 2 | 0 | 0.03s |
| `tests/standard-engine.test.ts` | 10 | 10 | 0 | 0.03s |
| `tests/stats.test.ts` | 4 | 4 | 0 | 0.01s |
| `tests/utilities.test.ts` | 25 | 25 | 0 | 0.03s |

## Test cases

### tests/bandwidth-limiter.test.ts

- **PASS** bandwidth math computes delay from byte count and rate (4.077699999999936 ms)
- **PASS** bandwidth math uses the stricter of global and per-download limits (0.8501999999999725 ms)
- **PASS** token-bucket rate limiter allows small transfers from the initial burst without waiting (0.8078000000000429 ms)
- **PASS** token-bucket rate limiter delays transfers that exceed the available tokens (358.2591 ms)
- **PASS** token-bucket rate limiter is a no-op when unlimited and can be updated at runtime (1.0557000000000016 ms)
- **PASS** token-bucket rate limiter stops waiting when the transfer is aborted (6.260400000000004 ms)

### tests/coordinator.test.ts

- **PASS** coordinator download state machine queues, starts through Chrome, pauses, resumes, cancels and removes a standard download (63.577800000000025 ms)
- **PASS** coordinator download state machine keeps queued work on hold while the queue is paused and resumes it later (121.46270000000004 ms)
- **PASS** coordinator download state machine stops the queue by pausing active transfers and can resume them all (47.545999999999935 ms)
- **PASS** queue priority and ordering clamps priorities and reorders queued records (12.213200000000029 ms)
- **PASS** page URL guard refuses to save a video watch page as a file (5.8940000000000055 ms)
- **PASS** page URL guard accepts a direct media file URL (3.240599999999972 ms)
- **PASS** engine events and history maintenance applies engine progress and converts engine failures to resumable records (7.264299999999935 ms)
- **PASS** engine events and history maintenance moves a failed segmented transfer back to the standard queue on fallback (9.052899999999909 ms)
- **PASS** engine events and history maintenance clears terminal history but keeps active work (5.768399999999929 ms)
- **PASS** engine events and history maintenance derives stats from persisted records (3.657199999999875 ms)

### tests/dash-detector.test.ts

- **PASS** ISO 8601 durations parses day, hour, minute and second components (2.0536999999999352 ms)
- **PASS** ISO 8601 durations returns undefined for missing or malformed values (0.2316000000000713 ms)
- **PASS** DASH manifest parsing extracts representations, templates and base URLs (15.315200000000004 ms)
- **PASS** DASH manifest parsing supports SegmentList representations (4.350399999999809 ms)
- **PASS** DASH manifest parsing sorts downloadable representations by quality (4.488600000000133 ms)
- **PASS** DASH manifest parsing rejects non-MPD XML and manifests without representations (2.199500000000171 ms)
- **PASS** DASH manifest parsing marks dynamic manifests honestly (1.1965000000000146 ms)

### tests/detection.test.ts

- **PASS** download link detection detects supported document, archive and software links (8.893000000000029 ms)
- **PASS** download link detection uses and sanitizes a hint filename (1.3564999999999827 ms)
- **PASS** download link detection rejects ordinary pages, unsafe protocols and extensionless targets (2.1976999999999407 ms)
- **PASS** download link detection respects download attributes and MIME hints (2.7834000000000287 ms)
- **PASS** download link detection adds a missing extension to a hint filename from its MIME type (0.9373000000000502 ms)
- **PASS** download link detection matches ignored hosts including subdomains (1.6415000000000646 ms)
- **PASS** media detection identifies direct video and audio URLs (1.0398999999999887 ms)
- **PASS** media detection identifies HLS and DASH manifests (0.6094000000000506 ms)
- **PASS** media detection accepts media MIME types without a useful extension (0.6988000000000056 ms)
- **PASS** media detection creates normalized media resources (4.016100000000051 ms)
- **PASS** media detection falls back to a cleaned page title when the media item has no title (0.8623999999999796 ms)

### tests/downloads-store.test.ts

- **PASS** download metadata persistence stores, reads and lists records newest first (26.085300000000075 ms)
- **PASS** download metadata persistence updates the updatedAt timestamp on save (2.2724999999999227 ms)
- **PASS** download metadata persistence finds records by Chrome download id (2.300200000000018 ms)
- **PASS** download metadata persistence filters active and queued downloads with priority ordering (5.30499999999995 ms)
- **PASS** download metadata persistence deletes individual records and clears history (4.299100000000067 ms)
- **PASS** interruption recovery pauses segmented transfers that lost their worker but leaves native items alone (4.369599999999991 ms)

### tests/file-assembler.test.ts

- **PASS** segment planning splits an exact byte total into contiguous, gap-free ranges (6.848799999999983 ms)
- **PASS** segment planning reduces the segment count for files that are too small (1.0097000000000662 ms)
- **PASS** segment planning caps the number of segments at 16 (0.7545999999999822 ms)
- **PASS** segment planning distributes remainder bytes across the first segments (0.7939999999999827 ms)
- **PASS** segment planning rejects invalid file sizes (2.404700000000048 ms)
- **PASS** integrity checks detects gaps, overlaps and short coverage (2.8863999999999805 ms)
- **PASS** integrity checks throws when the assembled size differs from the expected size (1.0322999999999638 ms)

### tests/hls-detector.test.ts

- **PASS** HLS manifest parsing parses attribute lists with quoted values (5.694099999999935 ms)
- **PASS** HLS manifest parsing resolves relative media URLs safely (0.9912000000000489 ms)
- **PASS** HLS manifest parsing extracts master variants with absolute URLs (4.544599999999946 ms)
- **PASS** HLS manifest parsing extracts VOD segments, init maps, byte ranges and sequences (2.062000000000012 ms)
- **PASS** HLS manifest parsing flags encrypted streams instead of pretending to support them (0.7093999999999596 ms)
- **PASS** HLS manifest parsing treats METHOD=NONE as unencrypted (0.5158999999999878 ms)
- **PASS** HLS manifest parsing creates safe stream filenames (1.597599999999943 ms)

### tests/media-engine.test.ts

- **PASS** HLS media engine downloads a master playlist variant and assembles segments in order (133.02589999999998 ms)
- **PASS** HLS media engine refuses encrypted playlists without attempting a workaround (22.663900000000012 ms)
- **PASS** HLS media engine refuses live playlists that have not ended (8.054500000000075 ms)
- **PASS** HLS media engine routes direct media to the standard engine instead of faking stream support (1.7152999999999565 ms)

### tests/media-store.test.ts

- **PASS** detected media persistence stores and lists media newest first (24.375999999999976 ms)
- **PASS** detected media persistence deletes and clears media entries (5.633799999999951 ms)
- **PASS** detected media persistence prunes expired and excess records (3.2974000000000387 ms)
- **PASS** detected media persistence surfaces readable error messages (1.3086000000000695 ms)

### tests/queue-manager.test.ts

- **PASS** queue sorting and selection sorts by priority, then queue order, then creation time (5.552099999999996 ms)
- **PASS** queue sorting and selection counts probing, downloading and delivering as active (0.5486000000000217 ms)
- **PASS** queue sorting and selection starts only as many queued downloads as there are free slots (0.5355999999999881 ms)
- **PASS** queue sorting and selection continues queue order after the highest existing order (0.373800000000017 ms)
- **PASS** queue reordering reorders queued records and keeps active records untouched (0.5794999999999959 ms)
- **PASS** queue reordering ignores unknown ids and appends omitted queued ids (0.29129999999997835 ms)
- **PASS** queue reordering moves queued records up and down without crossing the edges (0.4549999999999841 ms)

### tests/range-validator.test.ts

- **PASS** Content-Range parsing parses complete and open-ended ranges (6.913199999999961 ms)
- **PASS** Content-Range parsing rejects malformed, inverted and out-of-bounds ranges (1.0565000000000282 ms)
- **PASS** Content-Range parsing parses Retry-After seconds and HTTP dates (2.044499999999971 ms)
- **PASS** segment response validation accepts matching 206 responses (3.800299999999993 ms)
- **PASS** segment response validation classifies authentication and range failures (4.366899999999987 ms)
- **PASS** segment response validation marks rate limits and server errors as retryable (1.2853000000000065 ms)
- **PASS** segment response validation detects missing, mismatched and changed ranges (2.2691999999999553 ms)
- **PASS** Range probing over real HTTP accepts a correctly supported range and reads metadata (76.11720000000003 ms)
- **PASS** Range probing over real HTTP reports honest fallback details when Range is ignored (22.609899999999925 ms)
- **PASS** Range probing over real HTTP reports a fallback when the server advertises but ignores Range (10.838300000000004 ms)
- **PASS** Range probing over real HTTP rejects untrustworthy Content-Range totals (16.96169999999995 ms)
- **PASS** Range probing over real HTTP surfaces authentication failures (10.094600000000014 ms)

### tests/retry-manager.test.ts

- **PASS** retry policy retries retryable engine errors and normal failures (4.956400000000031 ms)
- **PASS** retry policy never retries aborts (1.4087999999999283 ms)
- **PASS** withRetry returns after a transient failure and reports the retry (26.66039999999998 ms)
- **PASS** withRetry throws the last error after exhausting retries (15.961000000000013 ms)
- **PASS** withRetry does not retry non-retryable engine errors (0.8958999999999833 ms)
- **PASS** withRetry honors server-provided retry delays (9.693300000000022 ms)
- **PASS** withRetry aborts before the first attempt when the signal is already aborted (2.13880000000006 ms)
- **PASS** withRetry stops retrying when a signal aborts during the delay (24.362300000000005 ms)

### tests/scheduler-background.test.ts

- **PASS** scheduler CRUD and alarms creates a daily schedule, stores it and arms a Chrome alarm (20.137300000000096 ms)
- **PASS** scheduler CRUD and alarms validates one-off times before saving (4.729799999999955 ms)
- **PASS** scheduler CRUD and alarms runs a one-off schedule now, records the run and disarms it (3.080500000000029 ms)
- **PASS** scheduler CRUD and alarms executes pause-all schedules through the coordinator (1.6733000000000402 ms)
- **PASS** scheduler CRUD and alarms handles only its own alarm names (1.6995000000000573 ms)
- **PASS** scheduler CRUD and alarms updates, disables and deletes schedules (6.044800000000009 ms)
- **PASS** scheduler CRUD and alarms disables expired one-off jobs and clears stale alarms on resync (2.805500000000052 ms)

### tests/scheduler-shared.test.ts

- **PASS** daily time parsing accepts 24-hour HH:MM values (3.984100000000012 ms)
- **PASS** daily time parsing rejects malformed or out-of-range values (0.47759999999999536 ms)
- **PASS** next-run calculation schedules later today or tomorrow for daily jobs (0.6888999999999896 ms)
- **PASS** next-run calculation rejects invalid daily times (1.8973000000000297 ms)
- **PASS** next-run calculation honors enabled state and one-off times (0.8870000000000005 ms)
- **PASS** due detection and countdown labels detects schedules within the alarm tolerance (1.0341999999999985 ms)
- **PASS** due detection and countdown labels formats human-readable countdowns (0.7082000000000335 ms)

### tests/segment-storage.test.ts

- **PASS** in-memory segment storage reports zero for new segments and tracks appended bytes (5.587600000000066 ms)
- **PASS** in-memory segment storage resets a segment when stored data exceeds the expected size (0.7763999999999669 ms)
- **PASS** in-memory segment storage assembles segments in the requested order with the right type (1.70150000000001 ms)
- **PASS** in-memory segment storage copies appended chunks so later mutation cannot corrupt the transfer (1.3671999999999116 ms)
- **PASS** in-memory segment storage resets individual segments and removes whole jobs (0.9739000000000715 ms)
- **PASS** in-memory segment storage reports OPFS availability honestly in a non-browser runtime (0.7905999999999267 ms)

### tests/segmented-engine.test.ts

- **PASS** segmented transfer engine downloads, assembles and verifies a multi-segment file over HTTP Range (181.27390000000003 ms)
- **PASS** segmented transfer engine resumes from persisted segment data (86.93529999999998 ms)
- **PASS** segmented transfer engine falls back honestly when the server ignores Range (50.20499999999993 ms)
- **PASS** segmented transfer engine falls back when the file exceeds the configured segmented safety limit (2.8611000000000786 ms)

### tests/settings-store.test.ts

- **PASS** settings normalization returns safe defaults when nothing is stored (8.591300000000047 ms)
- **PASS** settings normalization clamps numeric ranges and normalizes folders and enums (2.2346999999999753 ms)
- **PASS** settings normalization persists updates and notifies settings watchers (5.124000000000024 ms)
- **PASS** queue state defaults to running and persists pause/resume (1.7311999999999443 ms)
- **PASS** schedule persistence rejects schedules that are missing required fields (0.9859000000000151 ms)
- **PASS** schedule persistence normalizes valid schedules and clamps the download count (1.0538999999999987 ms)
- **PASS** schedule persistence saves, filters invalid rows and sorts by next run (1.259900000000016 ms)

### tests/site-formats.test.ts

- **PASS** site format normalization sorts video choices best-first and audio choices by bitrate (8.581199999999967 ms)
- **PASS** site format normalization marks video-only streams as merge choices with a yt-dlp expression (3.7089999999999463 ms)
- **PASS** site format normalization disables merge-only choices when FFmpeg is unavailable (1.7642000000000735 ms)
- **PASS** site format normalization chooses the best downloadable format and skips storyboards and DRM (1.1948000000001002 ms)
- **PASS** site format normalization keeps only the highest bitrate option for duplicate resolution and container (2.2386999999999944 ms)
- **PASS** site format normalization marks live streams as unavailable and tolerates empty metadata (0.6494999999999891 ms)
- **PASS** site format normalization produces a short summary for the queue UI (0.7169999999999845 ms)

### tests/site-helper.test.ts

- **PASS** site helper connection lifecycle rejects requests when the connection is reset so their timers cannot kill a newer port (22.184499999999957 ms)
- **PASS** site helper connection lifecycle ignores a late disconnect from a replaced port (3.185200000000009 ms)

### tests/standard-engine.test.ts

- **PASS** Chrome download state mapping maps complete, paused, active and interrupted items honestly (7.036799999999971 ms)
- **PASS** Chrome download state mapping applies Chrome progress to a record (2.414700000000039 ms)
- **PASS** Chrome download state mapping marks completed items with the final file size (1.0874000000000024 ms)
- **PASS** Chrome download state mapping records Chrome errors for failed items (1.1243999999999232 ms)
- **PASS** Chrome download state mapping imports non-DownFlow Chrome history as a native record (3.737799999999993 ms)
- **PASS** startStandardDownload sends a categorised path and conflict policy to the Downloads API (2.268199999999979 ms)
- **PASS** startStandardDownload uses uniquify by default and supports ask-where-to-save (0.8187000000000353 ms)
- **PASS** startStandardDownload wraps Chrome failures in a useful message (3.604400000000055 ms)
- **PASS** startStandardDownload rejects a response without a numeric download id (1.197499999999991 ms)
- **PASS** record helpers preserves existing progress when Chrome reports fewer bytes (0.8048000000000002 ms)

### tests/stats.test.ts

- **PASS** statistics from stored downloads derives counts, byte totals, categories and speed from real records (10.974399999999946 ms)
- **PASS** statistics from stored downloads falls back to the average of completed speeds when timings are missing (0.5285999999999831 ms)
- **PASS** statistics from stored downloads returns zeros and empty structures for an empty history (1.1024999999999636 ms)
- **PASS** statistics from stored downloads uses completion duration when available for average speed (0.6435999999999922 ms)

### tests/utilities.test.ts

- **PASS** filename and path safety removes path traversal, reserved names and invalid characters (6.794399999999996 ms)
- **PASS** filename and path safety truncates long names but preserves the extension (1.64650000000006 ms)
- **PASS** filename and path safety sanitizes folder segments and blocks parent traversal (0.9831000000000358 ms)
- **PASS** filename and path safety builds category-aware download paths (0.7538999999999305 ms)
- **PASS** extension and category detection extracts extensions from names and URLs (0.9302000000000135 ms)
- **PASS** extension and category detection maps extensions and MIME types to categories (1.2692999999999302 ms)
- **PASS** URL validation accepts only safe http(s) URLs (1.1029000000000906 ms)
- **PASS** URL validation normalizes the source domain (0.7218000000000302 ms)
- **PASS** formatting helpers formats byte and speed values with binary units (1.0471999999999753 ms)
- **PASS** formatting helpers formats durations and ETAs (0.980199999999968 ms)
- **PASS** formatting helpers computes progress, speed and ETA from raw counters (0.987700000000018 ms)
- **PASS** filename resolution for real downloads names each download from its own title, not a shared placeholder (3.4911999999999352 ms)
- **PASS** filename resolution for real downloads adds the correct media extension to an extensionless title (1.9099999999999682 ms)
- **PASS** filename resolution for real downloads keeps a real extension and replaces a misleading one (1.3328000000000202 ms)
- **PASS** filename resolution for real downloads prefers a server filename and never invents a shared name (1.2559999999999718 ms)
- **PASS** filename resolution for real downloads uses a meaningful title over a generic URL basename (1.3950999999999567 ms)
- **PASS** filename resolution for real downloads resolves stream filenames and cleans site suffixes (0.8140999999999394 ms)
- **PASS** filename resolution for real downloads exposes extension inference helpers (0.7492999999999483 ms)
- **PASS** page URL detection rejects video and audio pages that only contain HTML (1.7381000000000313 ms)
- **PASS** page URL detection rejects page-shaped paths on ordinary hosts (0.6823000000000548 ms)
- **PASS** page URL detection allows direct files, stream manifests and media CDNs (0.5502999999999929 ms)
- **PASS** page URL detection reports whether a URL path looks like a real file (0.3424999999999727 ms)
- **PASS** content disposition and duplicates parses plain and RFC 5987 filenames (0.768799999999942 ms)
- **PASS** content disposition and duplicates uniquifies names case-insensitively (0.37809999999990396 ms)
- **PASS** content disposition and duplicates creates stable local day keys (0.4895999999999958 ms)

## What is covered

- Download metadata persistence, queue ordering, and interrupted-transfer recovery
- HTTP Range probing, Content-Range validation, retry policy, and bandwidth limits
- Real local HTTP segmented transfers: multi-segment assembly, resume, Range fallback, and safety limits
- Chrome Downloads state mapping and the coordinator state machine (queue, pause, resume, cancel, remove)
- Scheduler due-job selection plus background alarm scheduling
- Filename/path safety, duplicate policies, categories, and MIME/extension detection
- HLS/DASH manifest parsing and HLS segment assembly order
- Statistics derived from stored download records and settings persistence

## Not covered by automated tests

These require a real Chrome installation and are listed in `docs/CHROME_VERIFICATION.md`:

- Loading the unpacked extension, popup/side-panel rendering, and real Chrome UI interactions
- Chrome-managed file writes, download prompts, and native download events
- OPFS behavior under Chrome storage pressure and service-worker suspension
- DRM-protected media rejection on live sites and site-specific interception behavior
