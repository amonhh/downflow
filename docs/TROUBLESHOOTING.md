# DownFlow troubleshooting

This guide covers the problems most likely to appear on Windows. Work from the
top of the relevant section; each step tells you what to check and what a healthy
result looks like.

---

## 1. `npm` is not recognized, or PowerShell blocks `npm.ps1`

**Symptoms**

- `npm : The term 'npm' is not recognized...`
- `npm.ps1 cannot be loaded because running scripts is disabled on this system.`

**Fix**

1. Close PowerShell, open it again, and run:

   ```powershell
   node --version
   npm --version
   ```

2. If the commands are still missing, reinstall Node.js LTS with **Add to PATH**
   enabled, then reopen PowerShell.
3. If only `.ps1` scripts are blocked, use the `.cmd` wrapper:

   ```powershell
   npm.cmd install
   npm.cmd run build
   ```

   Or allow local scripts for your user (only if your organisation permits it):

   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
   ```

4. Confirm you are in the folder that contains `package.json`:

   ```powershell
   cd C:\path\to\downflow
   Get-ChildItem package.json
   ```

---

## 2. `npm install` fails

- Check the internet connection and any corporate proxy/VPN.
- Delete only the dependency cache and retry:

  ```powershell
  npm cache clean --force
  npm install
  ```

- On a very old Node.js, upgrade to the current LTS. This project was verified
  with Node.js 24.22.1.
- `EPERM`/`EBUSY` on Windows usually means antivirus or another process is
  holding `node_modules`. Close editors/terminals, retry, or reboot.
- Do not run `npm install` with administrator rights unless your environment
  requires it.

---

## 3. `npm run build` fails

Run the stages separately to see the real error:

```powershell
npm run typecheck
npm run build
```

Common causes:

| Message | Meaning / fix |
| --- | --- |
| `error TS####` | A TypeScript error in `src/`. Read the file and line shown. |
| `Could not resolve ...` | A missing import or dependency. Run `npm install`, check the path. |
| `vite: not found` | Dependencies are missing. Run `npm install`. |
| `DownFlow build verification failed` | One output file is missing. Run `npm run build` again from the project root; check `dist/`. |
| `EACCES` / `EPERM` on `dist` | Close anything locking `dist` (Explorer preview, antivirus), or run `npm run clean` and rebuild. |

A successful build ends with:

```text
DownFlow build verification passed.
```

---

## 4. Chrome says "Manifest file is missing or unreadable"

- You selected the wrong folder. Load `C:\path\to\downflow\dist`, **not**
  `C:\path\to\downflow` and not `dist\assets`.
- Check that `dist\manifest.json` exists. If not, the build did not finish.
  Run `npm run build` again.
- Do not rename or move files inside `dist` after building.

---

## 5. The extension loads but the popup/dashboard is blank or shows an error

1. Open `chrome://extensions`.
2. Find DownFlow. If there is an **Errors** button, click it and read the first
   error.
3. Click the **reload** icon on the DownFlow card.
4. Close and reopen the popup. For the dashboard, close the old tab and open it
   again.
5. Open DevTools on the popup/dashboard (`Ctrl+Shift+I`) and check the Console.

A blank dashboard after editing source usually means `dist/` is stale. Rebuild:

```powershell
npm run build
```

Then reload the extension.

---

## 6. "DownFlow's background service is starting" / "Receiving end does not exist"

The popup/dashboard could not reach the MV3 service worker.

- Wait a second and retry; Chrome may be waking the worker.
- Reload the extension on `chrome://extensions`.
- Inspect the worker: click the **service worker** link on the DownFlow card. In
  its DevTools Console, look for startup exceptions.
- If the worker shows **Inactive**, that is normal MV3 behaviour. It wakes when
  the UI sends a message.
- If you just rebuilt, the old worker may still be registered. Reload the
  extension, then reopen the UI.

The production build has been smoke-tested against the real message API. If the
worker crashes at startup, use its DevTools Console for the exact exception and
report/reproduce it with `npm run smoke:browser`.

---

## 7. Downloads do not start

- Check the URL. DownFlow accepts `http:` and `https:` only. `file:`,
  `javascript:`, `data:` and pages that require a login may be rejected.
- Try the same URL in Chrome's own download flow. If Chrome fails too, the site
  or link is the problem (authentication, expiry, hotlink protection).
- Open **Settings → Download** and confirm **Maximum simultaneous downloads** is
  not zero and the queue is not paused. Use **Start queue**.
- Check that Chrome has permission to write to the download folder. Try the
  default Downloads folder.
- Check free disk space.
- Open the dashboard and read the card's error text; it maps common Chrome errors
  such as `SERVER_UNAUTHORIZED`, `FILE_NO_SPACE`, `FILE_ACCESS_DENIED`,
  `NETWORK_DISCONNECTED`, `USER_CANCELED`.

---

## 8. Segmented downloads fall back to "Standard mode"

This is expected for servers that cannot support safe segmented transfers. Hover
the **Standard mode** chip to see the reason recorded for that download. Common
reasons:

- The server answers Range requests with `200 OK` instead of `206 Partial Content`.
- `Content-Range`, `Content-Length` or the total size is missing/inconsistent.
- Etag/Last-Modified changes between segment requests.
- The server rejects or throttles concurrent connections.
- The file is smaller than the 2 MiB minimum segment size.
- The file exceeds the configured memory safety limit (default 512 MB).
- Segmented downloads are disabled in Settings.
- The Range probe failed (CORS/network/auth).

DownFlow deliberately does not force segmentation on an unsafe server. Use the
standard engine for those files; the download still completes.

### Segmented file is in the default Downloads folder, not my DownFlow folder

This is a Chrome limitation, not a bug. Chrome's Downloads API ignores the
`filename` option for `blob:` URLs and would save the file under a UUID. DownFlow
therefore uses a hidden blob link to preserve the real filename, and Chrome saves
it in the browser's default download destination. The configured DownFlow folder,
category folders and duplicate policy apply to standard Downloads API transfers.
See the limitation note in the README.

### Segmented download is stuck on "Saving file"

The assembled file could not be handed to Chrome. DownFlow fails the record after
about a minute with a clear error. Click **Retry**; if the prepared blob is still
available, it re-delivers without downloading again. If not, it starts a fresh
transfer.

---

## 9. A detected file prompt does not appear

- Reload the web page after installing or reloading the extension; content
  scripts only run in newly loaded pages.
- Chrome does not allow content scripts on `chrome://` pages, the Chrome Web
  Store, or other browser-internal pages. Use the right-click menu or add the URL
  manually.
- Some sites generate downloads through JavaScript or use `blob:` URLs. DownFlow
  cannot inspect every synthetic download; use **Add download** or let Chrome's
  Downloads API event appear in the dashboard.
- Check **Settings → General → Detect downloadable links** and
  **Panels → detection** settings. Disabling detection stops prompts.
- Some strict site CSPs can interfere with the in-page overlay. The context menu
  remains available as the reliable fallback.

Right-click menu entries:

- **Download with DownFlow**
- **Add to queue**
- **Copy download link**

---

## 10. Video/audio is not listed, or media download fails

- Open the dashboard's **Video and Audio** page and refresh after starting
  playback.
- Direct MP4/WebM/MP3/WAV/M4A/OGG files are supported.
- HLS detection works for accessible, unencrypted VOD playlists. DRM/encrypted
  streams are intentionally not supported and are never bypassed.
- DASH detection works for accessible non-DRM representations. Separate audio and
  video tracks are not merged.
- When several qualities are available, **Download** opens a format/quality picker
  sorted best-first. Choose the row you want, then **Start download**.
- YouTube and similar watch pages are not media files. Install the optional
  helper (see below) to probe them with yt-dlp; without it DownFlow rejects those
  page URLs instead of saving an HTML file. DRM/MSE streams are not bypassed.
- Some players use `blob:`/MSE streams that do not expose a downloadable manifest.
  These cannot be downloaded as a normal file by an extension.
- If the media link expires quickly, reload the page and start the download
  promptly.

---

## 11. Queue problems

| Symptom | Check |
| --- | --- |
| Nothing starts | Queue paused? Use **Start queue**. Concurrency set to 0? |
| Only one download runs | **Maximum simultaneous downloads** is 1. |
| Reordering has no effect | Active downloads cannot be reordered; only queued items move. |
| Queue state lost after restart | Queue state is stored in `chrome.storage.local`; clearing extension data resets it. |

---

## 12. Scheduler does not fire

- Chrome must be **running**. DownFlow cannot run downloads while Chrome is fully
  closed, and this is not a bug.
- System sleep can delay Chrome alarms. Wake the machine and Chrome; the missed
  job may run when the browser resumes, depending on Chrome's alarm policy.
- Check the schedule is **Enabled**, has a future one-off time or a valid daily
  `HH:MM` time, and is not past its `maxDownloads` limit.
- Open `chrome://extensions` → DownFlow → **service worker** and check the Console
  for alarm errors.
- Reload the extension after changing schedules if the worker was updated.

---

## 13. Notifications do not appear

- **Settings → General → Notifications** must be enabled.
- Check Windows notification settings for Chrome: Settings → System →
  Notifications → Google Chrome.
- Chrome may suppress notifications in Focus Assist / Do Not Disturb.
- Media notifications have their own toggle under **Media detection
  notifications**.

---

## 14. Copy URL / clipboard does not work

DownFlow uses `navigator.clipboard` and falls back to an offscreen document with
`document.execCommand('copy')`. If both are blocked:

- Make sure the page/dashboard has focus.
- Check the extension has the `clipboardWrite` permission (it is in the manifest).
- Reload the extension and try again.

---

## 15. Statistics or history look wrong

- Stats are computed from locally stored download records, not from Chrome's
  global history.
- Completed/failed counts only include records DownFlow knows about. Downloads
  started before installation or in other profiles are not included.
- **Clear download history** removes terminal records; active downloads are kept.
- Clearing Chrome site data/extension data removes the IndexedDB records. There is
  no cloud backup.

### Reset temporary segment data

Dashboard → Settings → Privacy → **Clear temporary segment data**. Cancel active
transfers first; the action refuses while segments are in use.

---

## 16. Checking logs and collecting evidence

1. **Service worker logs:** `chrome://extensions` → DownFlow → click
   **service worker**. Errors and console messages appear there.
2. **UI logs:** open the popup/dashboard and press `Ctrl+Shift+I`.
3. **Extension errors:** `chrome://extensions` → DownFlow → **Errors**.
4. **Automated evidence:** run the suite and keep the generated reports:

   ```powershell
   npm test
   npm run test:report
   npm run build
   npm run smoke:browser
   ```

   `TEST_REPORT.md` and `BROWSER_SMOKE_REPORT.md` are generated from real runs.
5. **Network issues:** in the dashboard DevTools, use the Network tab for UI
   requests. Segmented transfer requests run in the offscreen document; inspect
   it via the extension's DevTools target list if needed.

---

## 17. Last-resort clean rebuild

```powershell
cd C:\path\to\downflow
npm run clean
npm install
npm run build
```

Then:

1. `chrome://extensions` → remove DownFlow.
2. **Load unpacked** → select `C:\path\to\downflow\dist`.
3. Reload the test page.

If it still fails, capture the exact error text from the build output or the
service worker Console before changing code. Guessing without the error usually
wastes more time.

---

## 18. Video-site helper (YouTube and similar sites)

Site downloads use an optional local helper that runs yt-dlp. Full setup is in
[VIDEO_SITES.md](VIDEO_SITES.md).

| Symptom | Fix |
| --- | --- |
| “The optional DownFlow helper is not installed” | Run `npm run native:install -- --extension-id=<id>`, then reload the extension. The ID must match the loaded extension exactly. |
| “The DownFlow helper timed out” | Retry once. Check `npm run native:status`. If it persists, reinstall the helper and reload the extension. |
| yt-dlp not found | Run `npm run native:install -- --download-ytdlp` or put `yt-dlp.exe` on `PATH`. |
| High-quality video choices are disabled | Run `npm run native:install -- --download-ffmpeg` (or install FFmpeg and add `ffmpeg.exe` to `PATH`), then press **Refresh** in Settings → Video sites. Without FFmpeg, separate video/audio streams cannot be merged. |
| “This is a live stream” | Live streams are not supported by the current helper. |
| Login/403/Unsupported URL | The site needs an account, DRM, or a newer yt-dlp. Update yt-dlp; DownFlow does not bypass access controls. |
| Files are missing from Chrome's downloads | The helper writes to `Downloads\DownFlow` (or `DOWNFLOW_OUTPUT_DIR`), outside Chrome's download manager. Use **Show in folder** in DownFlow. |
| **Show in folder** reports an `explorer.exe` error or does nothing | The helper installed under `%LOCALAPPDATA%\DownFlow\native` is stale. Reinstall it with `npm run native:install -- --extension-id=<id>` and retry. Explorer exits with a nonzero code even when it succeeds, so current helper versions ignore that code. |
| **Show in folder** says the file is no longer at that path | The file was moved, renamed, or deleted after the download finished. The message includes the last known full path. |
| Need details | Read `%LOCALAPPDATA%\DownFlow\jobs\helper.log` and `%LOCALAPPDATA%\DownFlow\jobs\<job-id>.log`. |

Remove the helper at any time with:

```powershell
npm run native:uninstall
```
