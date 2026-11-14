# DownFlow manual Chrome verification checklist

This checklist is for the parts of DownFlow that cannot be proven by the
automated test suite or the headless browser smoke test. It is a **procedure**,
not a claim that these steps have already been performed.

Automated evidence that already exists:

- `npm test` — 168 unit/integration tests across 22 files (`TEST_REPORT.md`).
- `npm run smoke:browser` — 15/15 checks in a real Chromium browser, including a
  native download and a full 5 MiB / 2-segment Range + OPFS download
  (`BROWSER_SMOKE_REPORT.md`).

What still needs a real browsing session: in-page detection prompts, right-click
context menus, live media/HLS/DASH capture, pause/resume of real servers,
service-worker suspension behaviour, and Chrome restart recovery.

---

## 0. Preparation

1. Build and load the extension:

   ```powershell
   cd C:\path\to\downflow
   npm install
   npm run build
   ```

2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**
   and select `C:\path\to\downflow\dist`.
3. Pin the DownFlow toolbar icon.
4. Start the local test server in a second PowerShell window:

   ```powershell
   npm run test:server
   ```

   You should see:

   ```text
   DownFlow manual test server running at http://127.0.0.1:4310/
   ```

5. Keep `chrome://extensions` open in a tab. The DownFlow card has a
   **service worker** link; use it whenever a step asks for worker logs.
6. Treat the download folder as disposable. The test server files are
   deterministic dummy bytes, not real documents or playable media.

> Record each result in the table at the end. "Not run" is a valid, honest entry.

---

## 1. Popup basics

1. Click the DownFlow toolbar icon.
2. Confirm the popup renders: header, active downloads area, speed summary, and
   the quick actions.
3. Confirm there are no runtime errors. If the popup is blank, right-click it,
   choose **Inspect**, and read the Console.

**Pass when:** the popup renders and the Console has no uncaught exception.

---

## 2. Dashboard navigation and layout

1. Open the dashboard (popup → **Open dashboard**, or right-click the icon →
   **Options** for the options page).
2. Confirm every section is reachable:
   **Overview, All downloads, Downloading, Queued, Completed, Paused, Failed,
   Video & audio, Categories, Statistics, Scheduler, Settings**.
3. Resize the window narrow; confirm the layout does not overflow horizontally.
4. Confirm counts next to nav items change when downloads are added or finish.

**Pass when:** all sections open without a blank page or console error.

---

## 3. Standard (native Chrome) download lifecycle

Use the test server page `http://127.0.0.1:4310/`.

1. Copy `http://127.0.0.1:4310/files/sample.pdf`.
2. In the dashboard, use **Add download**, paste the URL, and start it. For a naming
   check, type a distinctive name without an extension in the optional **Filename**
   field (for example `Renamed Report`) before starting.
3. Watch the card: filename, source `127.0.0.1`, extension `.pdf`, size,
   progress, speed, ETA and status. The saved name must be the name you typed plus
   `.pdf` (not the server's `sample.pdf` and not an `.exe`).
4. Pause it. Confirm Chrome's own download is paused (the card and
   `chrome://downloads` agree).
5. Resume it. Confirm it continues from where it paused.
6. Start a second download and cancel it. Confirm it leaves the active list and
   shows **Cancelled**/removed appropriately.
7. On a completed card, test **Open file** and **Show in folder**.
8. Confirm the file exists in your Downloads folder (or the DownFlow folder if
   category folders are enabled) with the correct size.

**Pass when:** start, pause, resume, cancel, open and show-in-folder all work and
the UI matches Chrome's download state.

Notes:

- Chrome controls the actual save dialog/folder. If **Ask where to save** is
  enabled in Chrome settings, Chrome's own prompt appears.
- Standard downloads are throttle-exempt: Chrome's Downloads API exposes no
  per-transfer rate control. Bandwidth limits apply to DownFlow's segmented and
  media engines.
- Read the authoritative saved name from `chrome.downloads.search(...).filename`.
  Do **not** use CDP `Browser.setDownloadBehavior` for filename checks: that
  test-harness override makes Chrome derive the name from the URL and ignore the
  requested filename. It is not DownFlow behaviour.

## 3b. Page URLs are refused without the helper; video sites use the helper

1. With the optional helper **not** installed, add
   `https://www.youtube.com/watch?v=wHfaCXRVO8U`.
2. Confirm it is rejected with a message that this is a video/audio web page and
   that the helper is not installed. No download should start and no HTML file
   should be saved.
3. Add `https://httpbin.org/html` (an HTML response whose URL has no file
   extension). Confirm the card ends as **Failed** with error code `NOT_A_FILE`
   and that no `html` file is left in Downloads.
4. Add a direct file URL such as
   `https://download.samplelib.com/mp4/sample-10s.mp4` and confirm it still
   downloads normally.
5. Optional: install the helper (see [VIDEO_SITES.md](VIDEO_SITES.md)), reload the
   extension, open a YouTube watch page, and confirm the popup/dashboard offers a
   quality list. Pick a combined or audio-only format and confirm it completes.
   With FFmpeg installed, also verify a video-only + audio merge.

**Pass when:** page URLs never produce saved HTML files, direct files are not
blocked, and helper-backed downloads produce the chosen file with the correct
name and container. Without the helper, DownFlow must state that honestly rather
than pretend the page is supported.

---

## 4. Segmented engine vs. honest fallback

### 4a. Segmented success

1. Settings → Download: enable **Segmented downloads**, connections `4`.
2. Add `http://127.0.0.1:4310/files/archive.zip` (5 MB, Range-capable).
3. Open the card. It should read **Segmented** and show multiple segment bars.
4. While it runs, pause and resume. Confirm it resumes from saved segment data
   rather than restarting from zero.
5. On completion, confirm the assembled file is exactly the same size as the
   source and that it opens/validates as a ZIP.
6. Confirm the file is saved with its real filename (`archive.zip`), not a
   UUID. Segmented deliveries use Chrome's default download folder; category
   folder routing applies to standard downloads.

### 4b. Fallback to standard mode

1. Add `http://127.0.0.1:4310/no-range/big.bin` (server ignores Range).
2. Confirm DownFlow does **not** force segmentation. The card shows a
   **Standard mode** chip.
3. Hover the chip and confirm a reason is shown (e.g. Range not supported).
4. Confirm the file still downloads completely through Chrome.

### 4c. Failure surfaced honestly

1. Add `http://127.0.0.1:4310/expired/report.pdf` (HTTP 410).
2. Confirm the record fails with a clear error, not a fake completion.
3. Add `http://127.0.0.1:4310/auth/protected.pdf` (HTTP 401).
4. Confirm the error explains that the server requires authentication.
5. Use **Retry** on a failed record and confirm it either retries or explains why
   it cannot.

**Pass when:** segmented, fallback, and failure states are all visible and match
reality; no download is reported complete unless the file actually exists at the
expected size.

---

## 5. Link/click detection and context menus

1. Reload `http://127.0.0.1:4310/` **after** loading/reloading the extension so
   the content script is injected.
2. Click a file link (for example `sample.pdf`).
3. Confirm the in-page DownFlow prompt appears with the filename and choices such
   as **Download with DownFlow** / **Download normally**.
4. Choose **Download with DownFlow**; confirm the download appears in the
   dashboard with source `detection`.
5. Repeat and choose **Download normally**; confirm DownFlow does not take over.
6. Right-click a file link and confirm the menu entries:
   - **Download with DownFlow**
   - **Add to queue**
   - **Copy download link**
7. Test each entry.

**Pass when:** the prompt and all three context-menu actions work on a normal
HTTP page, and choosing "normally" leaves Chrome in control.

Known boundaries (not failures):

- `chrome://` pages, the Chrome Web Store and other restricted pages cannot run
  content scripts.
- JavaScript-generated `blob:` downloads and some site-specific handlers cannot
  be intercepted; use **Add download** or the context menu.
- A page loaded before the extension was installed/reloaded may need a refresh.

---

## 6. Media, HLS and DASH

1. On `http://127.0.0.1:4310/`, play the embedded `clip.mp4` and `tone.mp3` for a
   few seconds.
2. Open dashboard → **Video & audio**. Confirm the direct media resources are
   listed.
3. Open the **HLS** and **DASH** manifest links so they are fetched:
   - `http://127.0.0.1:4310/hls/demo.m3u8`
   - `http://127.0.0.1:4310/dash/demo.mpd`
4. Confirm both appear as media resources.
5. For a manifest with more than one variant or representation, press
   **Download** and confirm the **Choose format & quality** dialog opens. Its
   options must be sorted best-first, the highest must be preselected and marked
   **Best**, and choosing another row must update the selected state. With one
   option, Download must start immediately.
6. Start the HLS download. Confirm it fetches all 3 segments and assembles a
   single file. The test segments are dummy bytes, so the output is not playable;
   the check is detection, segment download, ordering and size.
7. Start the DASH download. Confirm it fetches the init segment plus all 6 media
   segments and assembles them.
8. Confirm separate audio/video tracks are **not** claimed to be merged, and
   encrypted/DRM streams are reported as not downloadable rather than bypassed.

**Pass when:** direct, HLS and DASH sources are discovered and their segments are
downloaded and assembled in order; protection is never bypassed.

Important honesty boundary: these test manifests use deterministic fake bytes.
They prove the pipeline, not codec/remux correctness. DownFlow concatenates
accessible segments; it does not remux every container.

---

## 7. Queue behaviour

1. Settings → Download: set **Maximum simultaneous downloads** to `1`.
2. Add three downloads (`sample.pdf`, `archive.zip`, `photo.png`).
3. Confirm one runs and the other two sit in **Queued**.
4. Reorder the queued items. Confirm the new order is respected when the next
   slot opens.
5. Use **Pause queue**. Confirm the running item finishes or pauses according to
   the UI and nothing new starts.
6. Use **Start queue**. Confirm the next item starts.
7. Set concurrency to `3` and confirm up to three run simultaneously.
8. Reload the extension and reopen the dashboard. Confirm queue order and paused
   state persist.

**Pass when:** concurrency, ordering, pause/resume and persistence all behave as
described.

---

## 8. Scheduler

1. Dashboard → **Scheduler**. Create a **once** schedule two minutes ahead with
   action **Start queue**.
2. Pause the queue and leave Chrome running.
3. At the scheduled time, confirm the queue starts.
4. Create a **daily** schedule with a valid `HH:MM`. Confirm it saves, shows the
   next run, and can be disabled/deleted.
5. Confirm the UI states that Chrome must be running for schedules to fire.

**Pass when:** a near-future one-off job fires while Chrome is open, and the
schedule persists across a dashboard reload.

Note: the scheduler cannot fire while Chrome is fully closed. That is a platform
limit, not a defect.

---

## 9. Bandwidth limits

1. Settings: set a **global** limit (for example `512` KB/s) and start a large
   segmented download.
2. Confirm measured throughput is in the same order of magnitude as the limit
   (short-lived bursts are normal).
3. Set a **per-download** limit and confirm it applies to segmented/media
   transfers.
4. Confirm the UI formats units correctly (B/s → KB/s → MB/s) and that the
   setting persists after reload.
5. Confirm standard Chrome downloads are documented as not throttled.

**Pass when:** limits visibly affect segmented/media throughput and persist.

---

## 10. Settings persistence

1. Change several settings: theme, default folder, category folders,
   concurrency, segment count, notification toggles, duplicate policy.
2. Reload the dashboard tab. Confirm the values persist.
3. Reload the extension on `chrome://extensions`. Reopen the dashboard and
   confirm the values still persist.
4. Change the theme and confirm it applies immediately across popup and
   dashboard.
5. Restore any values you changed, especially download folders.

**Pass when:** settings survive a UI reload and an extension reload, and are
stored via `chrome.storage.local`.

---

## 11. Service-worker suspension

MV3 service workers are stopped when idle. DownFlow must not pretend work
continues while it is not running.

1. Open `chrome://extensions` and find the DownFlow **service worker** link.
2. Wait for the worker to show **Inactive**, or click **Terminate** if your
   Chrome build offers it.
3. Open the popup. Confirm it wakes the worker and the UI still loads settings
   and download records.
4. Start a segmented download, then terminate the worker mid-transfer.
5. Reopen the popup. Confirm the record is recovered honestly: it is paused /
   marked recoverable rather than showing fake live progress, and **Resume**
   works.
6. Confirm the offscreen document is recreated when needed and that the transfer
   resumes from stored segment data.

**Pass when:** the UI recovers after worker suspension and no record claims to
be actively downloading while nothing is running.

---

## 12. Chrome restart recovery

1. Start a segmented download large enough to still be running.
2. Close Chrome completely (all windows).
3. Reopen Chrome and the dashboard.
4. Confirm incomplete transfers are shown as paused/recovered with an explanation
   such as "Chrome closed during this transfer."
5. Resume one. Confirm it continues from saved segments where possible.
6. Confirm completed native downloads still appear correctly and no duplicate
   history entries were created.
7. Confirm schedules are re-armed (next run times are shown).

**Pass when:** state is honest after a full restart and resumable work can
continue.

---

## 13. Statistics and history

1. Complete at least one download and fail at least one.
2. Open **Statistics**. Confirm totals, completed/failed counts, transferred bytes
   and category breakdowns match the visible records.
3. Confirm no impossible values (negative sizes, completion without bytes).
4. Use **Clear download history**. Confirm terminal records are removed and active
   downloads are kept.
5. Confirm **Clear temporary segment data** refuses while a transfer is active,
   then succeeds when idle.

**Pass when:** statistics are derived from stored records and match what the UI
shows.

---

## 14. Invalid and unsafe input

Try each of these through **Add download**:

| Input | Expected result |
| --- | --- |
| `javascript:alert(1)` | Rejected with a validation error. |
| `data:text/html,<h1>x</h1>` | Rejected. |
| `file:///C:/Windows/win.ini` | Rejected. |
| `ftp://example.com/file` | Rejected. |
| `https://user:pass@example.com/x` | Rejected (embedded credentials). |
| `http://127.0.0.1:4310/files/../../etc/passwd` | Normalised/rejected; no traversal outside intended path. |
| An empty string | Rejected with a clear message. |
| `http://127.0.0.1:1/nothing` | Fails with a network error, not a fake completion. |

Also confirm a filename like `CON`, `../evil.exe`, or one with control characters
is sanitised rather than written literally.

**Pass when:** unsafe schemes/credentials are rejected and unsafe filenames are
sanitised.

---

## 15. Record your results

Copy this table into an issue or your own notes and fill it in honestly.

| # | Area | Result (Pass / Fail / Not run) | Build / browser | Notes or evidence |
| --- | --- | --- | --- | --- |
| 1 | Popup basics | Not run | | |
| 2 | Dashboard navigation | Not run | | |
| 3 | Native download lifecycle | Not run | | |
| 4a | Segmented success | Not run | | |
| 4b | Standard-mode fallback | Not run | | |
| 4c | Failure surfaced | Not run | | |
| 5 | Detection + context menus | Not run | | |
| 6 | Media / HLS / DASH | Not run | | |
| 7 | Queue | Not run | | |
| 8 | Scheduler | Not run | | |
| 9 | Bandwidth limits | Not run | | |
| 10 | Settings persistence | Not run | | |
| 11 | Service-worker suspension | Not run | | |
| 12 | Chrome restart recovery | Not run | | |
| 13 | Statistics / history | Not run | | |
| 14 | Invalid input | Not run | | |

When reporting a failure, include:

- Chrome/Edge version and OS.
- The exact step and the observed vs. expected result.
- A screenshot or the copied Console error from the popup, dashboard, or
  service worker.
- Whether the extension was freshly built and reloaded.
