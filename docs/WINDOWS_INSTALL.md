# DownFlow on Windows — beginner install guide

This guide assumes no prior experience with Node.js or Chrome extension
development. You will build the extension once and load it into Chrome.

DownFlow is a **Chrome extension only**. There is no desktop app or background
service to install. An optional local helper for video-site downloads can be added
later; it is not required for the extension's normal downloads. See
[VIDEO_SITES.md](VIDEO_SITES.md).

---

## 1. What you need

- Windows 10 or 11.
- Google Chrome (version 116 or newer) or another Chromium browser.
- About 300 MB of free disk space for Node.js and build output.
- An internet connection **once**, to download Node.js and npm packages.

You do **not** need Git, Visual Studio, Python, Docker, or an account anywhere.

---

## 2. Install Node.js (one time)

1. Open <https://nodejs.org/> in your browser.
2. Download the **LTS** Windows installer (`.msi`, 64-bit).
3. Run the installer and keep the default options. Make sure
   **"Add to PATH"** is enabled.
4. When it finishes, open the Start menu, type `PowerShell`, and open
   **Windows PowerShell**.
5. Check the installation:

   ```powershell
   node --version
   npm --version
   ```

   You should see version numbers (for example `v24.22.1` and `11.19.1`). If
   Windows says the command is not recognized, close PowerShell, open it again,
   and retry. If it still fails, reinstall Node.js with "Add to PATH" checked.

---

## 3. Open the project folder

The project is in:

```text
C:\path\to\downflow
```

In PowerShell, go there:

```powershell
cd C:\path\to\downflow
```

Confirm you are in the right place:

```powershell
Get-ChildItem
```

You should see `package.json`, `src`, `public`, `tests`, `README.md`, and this
guide under `docs`.

> If you saved the project somewhere else, use your own path after `cd`.

---

## 4. Install dependencies (one time)

```powershell
npm install
```

This downloads React, TypeScript, Vite, Vitest and the type definitions into a
`node_modules` folder. It may take a few minutes. Warnings about deprecated
packages are normally harmless. If the command fails:

- Check your internet connection.
- Make sure you are in the folder that contains `package.json`.
- Try `npm cache clean --force` and then `npm install` again.

---

## 5. Build the production extension

```powershell
npm run build
```

What this does:

1. Runs the TypeScript check (`tsc --noEmit`).
2. Builds the React popup, dashboard, options page, offscreen page and background
   service worker with Vite.
3. Builds the content script with its own config.
4. Runs `scripts/verify-build.mjs`, which checks that every required file exists
   in `dist/`.

The last line should say:

```text
DownFlow build verification passed.
```

The finished extension is in:

```text
C:\path\to\downflow\dist
```

**Important:** load the `dist` folder into Chrome, not the project root. The
project root contains source files that Chrome cannot run directly.

If the build fails, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md). Do not continue
until the build passes.

---

## 6. Load DownFlow into Chrome

1. Open Google Chrome.
2. Type this in the address bar and press Enter:

   ```text
   chrome://extensions
   ```

3. Turn on **Developer mode** using the switch in the top-right corner.
4. Click **Load unpacked**.
5. In the folder picker, navigate to `C:\path\to\downflow\dist` and select
   the `dist` folder itself (click the folder once, then **Select Folder**).
6. DownFlow appears in the list. If it shows an error, click **Errors** and read
   the message (also see the troubleshooting guide).
7. Click the puzzle-piece icon in Chrome's toolbar and pin
   **DownFlow - Download Manager** so its icon stays visible.

You can also open the dashboard directly with the extension's **Open dashboard**
button, or right-click the toolbar icon and choose **Options**.

---

## 7. First test: standard download

1. Find a direct file link, for example a PDF, ZIP or image URL. A link that ends
   in `.pdf`, `.zip`, `.png`, etc. works best.
2. Right-click the link and choose **Download with DownFlow**. Or click the
   DownFlow icon → **Add download** and paste the URL.
3. The download appears in the popup and dashboard. Watch progress, speed and ETA.
4. When it finishes, use **Open file** or **Show in folder** on the download card.

If Chrome asks where to save the file, that is Chrome's own prompt. Choose a
writable folder such as your Downloads folder.

### Test pause, resume and cancel

- Start a larger file.
- Click **Pause**, wait, then click **Resume**.
- Start another download and click **Cancel**.

### Test the queue

1. Set **Maximum simultaneous downloads** in Settings to `1`.
2. Add two or three downloads.
3. Open **Queued** in the dashboard. Reorder items with the priority/order
   controls and use **Pause queue** / **Start queue**.

### Test the segmented engine

1. In **Settings → Download**, make sure **Segmented downloads** is enabled and
   set **Connections** to `4`.
2. Use a server that supports HTTP Range requests (most static file hosts and
   cloud storage links do).
3. Start the download and open the card. While it runs it should say
   **Segmented** and show individual segment progress.
4. If the server does not support safe Range downloads, DownFlow falls back to
   Chrome's standard engine and shows a **Standard mode** chip. That is expected,
   not an error.

### Test detection

1. Visit a page that links directly to a PDF, ZIP, MP3, MP4, etc.
2. DownFlow may show a small in-page prompt:
   **"DownFlow detected a downloadable file."**
3. Choose **Download with DownFlow** or **Download normally**.

Chrome does not allow an extension to replace every website's download handler,
so some sites will require the right-click menu or manual URL entry.

### Test the scheduler

1. Open **Scheduler** in the dashboard.
2. Create a one-off schedule a few minutes ahead with the action **Start queue**.
3. Keep Chrome running. When the time arrives, the queue starts.
4. Scheduled jobs cannot run while Chrome is fully closed.

### Optional: test video-site downloads

This needs the optional native helper. If you have not installed it, DownFlow will
say so and refuse the page instead of saving an HTML file.

1. Copy the extension ID from `chrome://extensions`.
2. In PowerShell:

   ```powershell
   npm run native:install -- --extension-id=<your-extension-id> --download-ytdlp --download-ffmpeg
   ```

   `--download-ffmpeg` is optional but required for separate high-quality
   video/audio streams.
3. Reload DownFlow, then open **Settings → Video sites** and press **Refresh**.
4. Open a video page, click the DownFlow icon, and choose the video-quality banner.
   Pick a format and start the download.
5. With FFmpeg, high-quality video-only choices are enabled and merged with the
   best audio track. Combined and audio-only formats work without it.

Full instructions and limitations: [VIDEO_SITES.md](VIDEO_SITES.md).

---

## 8. Updating after a code change

Whenever files in `src/`, `public/` or the HTML entries change:

```powershell
cd C:\path\to\downflow
npm run build
```

Then open `chrome://extensions`, find DownFlow, and click the **reload** icon
(the circular arrow on the card). Close and reopen the popup/dashboard tab. If
the background service worker changed, reloading the extension is required.

---

## 9. Running the automated checks (optional but recommended)

```powershell
npm test
npm run test:report
npm run smoke:browser
```

- `npm test` runs the 22 Vitest suites (168 tests).
- `npm run test:report` regenerates `TEST_REPORT.md` from the real results.
- `npm run smoke:browser` builds nothing by itself; run `npm run build` first. It
  loads `dist/` into a real Chromium browser, tests the UI/APIs, performs a
  native download and a segmented Range/OPFS download, and writes
  `BROWSER_SMOKE_REPORT.md`.

The smoke test first tries Google Chrome, then Microsoft Edge. Branded Google
Chrome builds may ignore command-line extension loading; when that happens the
script uses Edge and records which browser was used. This does not affect normal
loading through `chrome://extensions`.

---

## 10. Uninstalling

1. Open `chrome://extensions`.
2. Click **Remove** on the DownFlow card.
3. Optionally delete `C:\path\to\downflow` and the `node_modules` folder.

DownFlow's local records are removed with the extension. Downloaded files are
not deleted; remove them from your Downloads folder if you no longer want them.

---

## Quick reference

| Task | Command / location |
| --- | --- |
| Open project | `cd C:\path\to\downflow` |
| Install dependencies | `npm install` |
| Build extension | `npm run build` |
| Load in Chrome | `chrome://extensions` → Developer mode → Load unpacked → `dist` |
| Run tests | `npm test` |
| Regenerate test report | `npm run test:report` |
| Real-browser smoke test | `npm run smoke:browser` |
| Install video-site helper (optional) | `npm run native:install -- --extension-id=<id> --download-ytdlp --download-ffmpeg` |
| Check helper status | `npm run native:status` |
| Remove video-site helper | `npm run native:uninstall` |
| Dashboard source | `src/dashboard` |
| Background worker | `src/background/service-worker.ts` |
| Segmented engine | `src/engine/segmented-engine.ts` |
| Offscreen transfer host | `src/offscreen/offscreen.ts` |
| Manifest | `public/manifest.json` |
