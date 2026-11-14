# Video-site downloads (optional native helper)

DownFlow can save videos from pages such as YouTube by asking an **optional local
helper** to run [yt-dlp](https://github.com/yt-dlp/yt-dlp) on your computer. The
extension itself is still a Chrome Manifest V3 extension with no remote code and
no backend. The helper is a small Node.js program that the extension talks to
through Chrome's native-messaging API.

If the helper is not installed, DownFlow stays honest: it reports that the helper
is unavailable and refuses the page instead of saving the HTML page under a
misleading name.

> **Only download media you have permission to save.** DownFlow does not bypass
> DRM, paywalls, logins, region locks or website access controls. Live streams are
> not supported by the current helper.

---

## What the helper adds

- Detects real video pages (YouTube, Vimeo, TikTok, Dailymotion and the other
  sites yt-dlp supports) instead of treating them as ordinary links.
- Lists every available format/quality so you can pick one, similar to IDM's
  format list: resolution, container, codec, bitrate, approximate size, and
  whether video and audio are separate streams.
- Downloads the chosen format with yt-dlp and reports progress, speed and ETA
  back to the DownFlow dashboard.
- Keeps jobs in a separate detached process, so a download continues when the
  MV3 service worker is suspended; the extension re-attaches by polling job
  state.
- Saves output to `%USERPROFILE%\Downloads\DownFlow` by default
  (override with `DOWNFLOW_OUTPUT_DIR`), outside Chrome's Downloads API.

## Requirements

| Component | Needed for | Notes |
| --- | --- | --- |
| Windows 10/11 | Native helper | The installer currently registers the host on Windows only. |
| Node.js 20+ | Native helper | The installed `host.cmd` points at the Node.js executable that ran the installer. |
| yt-dlp | Any site download | Can be installed by the helper installer with `--download-ytdlp`. |
| FFmpeg | Merging separate video + audio streams | Optional. Without it, combined (muxed) formats and audio-only formats still work, but high-quality video-only choices are shown disabled. |

The rest of DownFlow (direct links, HLS/DASH, dashboard, queue, scheduler) works
without any of these.

## Install

1. Build the extension and load `dist/` as an unpacked extension. See
   [WINDOWS_INSTALL.md](WINDOWS_INSTALL.md).
2. Copy the extension ID from `chrome://extensions` (or
   `edge://extensions`). The helper installer can also compute the ID from the
   `dist` path, but passing the ID explicitly avoids guesswork.
3. From the project folder, register the helper:

   ```powershell
   cd C:\path\to\downflow
   npm run native:install -- --extension-id=<your-extension-id>
   ```

   Add yt-dlp and/or FFmpeg in the same step if they are not already installed:

   ```powershell
   npm run native:install -- --extension-id=<your-extension-id> --download-ytdlp
   npm run native:install -- --extension-id=<your-extension-id> --download-ffmpeg
   ```

   `--download-ytdlp` fetches the official yt-dlp GitHub release and verifies its
   published SHA-256 checksum when available. `--download-ffmpeg` fetches the
   official gyan.dev essentials build with the same checksum check and extracts
   `ffmpeg.exe` into `%LOCALAPPDATA%\DownFlow\bin`.

   The installer copies the helper into `%LOCALAPPDATA%\DownFlow\native`, writes
   `com.downflow.helper.json`, and registers the host for Chrome, Edge, Brave,
   Chromium and Vivaldi under the current user. It does **not** require
   administrator rights.

4. Reload the DownFlow extension.
5. Open **Dashboard → Settings → Video sites** and press **Refresh**. The panel
   should show the helper as available, with the yt-dlp and FFmpeg versions it
   found.
6. Check the helper at any time:

   ```powershell
   npm run native:status
   ```

### Installing FFmpeg

For separate high-quality video/audio streams, run:

```powershell
npm run native:install -- --extension-id=<your-extension-id> --download-ffmpeg
```

The installer downloads an official Windows essentials build from
<https://www.gyan.dev/ffmpeg/builds/>, checks its published SHA-256 checksum when
available, extracts `ffmpeg.exe` into `%LOCALAPPDATA%\DownFlow\bin`, and the helper
finds it automatically.

Alternatively, add the folder containing `ffmpeg.exe` to `PATH`, or point
`DOWNFLOW_FFMPEG` at the executable, then restart the browser (or press
**Refresh** in Settings) so the helper re-probes its tools.

Without FFmpeg, the quality list still shows video-only formats but marks them as
requiring a merge and disables them. Combined formats and audio-only formats are
downloadable.

## Use

- **Popup:** when the current tab is a supported video page, the popup shows a
  **Video page detected** banner and opens the dashboard add dialog for that URL.
- **Dashboard:** **Add download** detects video pages, probes them automatically,
  lists the available qualities best-first, and starts the chosen one. Video-only
  choices show a merge note; audio choices are grouped after the video choices.
- **Context menu:** on a supported media host, **Choose video quality with
  DownFlow** opens the same flow. Link downloads on a video page are handed off to
  the quality picker instead of downloading the HTML page.
- Site downloads appear as normal records in the dashboard with the chosen format
  label, progress, speed, ETA, open and show-in-folder actions.

## Where files are saved

The helper saves to:

```text
%USERPROFILE%\Downloads\DownFlow
```

Set `DOWNFLOW_OUTPUT_DIR` before starting the browser to change it. Because these
files are written by the helper rather than Chrome's Downloads API, Chrome's
download bubble does not list them and DownFlow's category folders do not apply.

## How it works

```text
Dashboard / popup
      │  site:probe / site:start / site:sync messages
      ▼
MV3 service worker ── native messaging port ── com.downflow.helper
                                                    │
                                                    ├── yt-dlp probe (metadata)
                                                    ├── downloads yt-dlp
                                                    └── detached download-job.mjs
                                                          ├── job JSON in %LOCALAPPDATA%\DownFlow\jobs
                                                          └── output in Downloads\DownFlow
```

The service worker polls job state through the same native port. The helper is
started only when a site action is requested; it is not a permanently running
service and nothing is sent to a remote server.

## Security notes

- Native messaging is restricted to the extension ID recorded at install time
  (`allowed_origins`).
- yt-dlp is downloaded only when you pass `--download-ytdlp`, from the official
  GitHub release, and the installer verifies the published SHA-256 checksum when
  it is available.
- FFmpeg is downloaded only when you pass `--download-ffmpeg`, from the official
  gyan.dev essentials build, with the same checksum verification and extraction
  into the DownFlow tools folder.
- The helper accepts only `http:`/`https:` URLs for probing.
- The extension never downloads or executes third-party binaries on its own.
- DRM-protected and storyboard-only formats are excluded from the picker.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Settings says the helper is not installed | Re-run `npm run native:install -- --extension-id=<id>`, then reload the extension. The extension ID must match exactly. |
| `The DownFlow helper timed out` | Retry once. If it repeats, run `npm run native:status` and reinstall the helper. Earlier builds had a connection-lifecycle bug that caused this; rebuild and reload the extension to get the fix. |
| yt-dlp is missing | Run `npm run native:install -- --download-ytdlp`, or install yt-dlp yourself and make sure it is on `PATH` or in `%LOCALAPPDATA%\DownFlow\bin`. |
| High-quality video options are disabled | FFmpeg is not installed or not on `PATH`. Run `npm run native:install -- --download-ffmpeg` (or install FFmpeg yourself), then press **Refresh** in Settings → Video sites. |
| “This is a live stream” | Live streams are not supported by the current helper. Wait for a VOD version. |
| A page fails with a login/403 error | The site requires an account, DRM, or changes that the installed yt-dlp does not support. Update yt-dlp and retry; DownFlow does not bypass access controls. |
| Download completes but the video has no picture/sound | A video-only format was downloaded without a merge. Install FFmpeg and choose a combined quality, or choose an audio-only format deliberately. |
| Files are not in Chrome's download list | The helper writes to `Downloads\DownFlow`; use **Show in folder** in DownFlow. |

Logs that help diagnose helper failures:

- `%LOCALAPPDATA%\DownFlow\jobs\helper.log` — helper requests and failures.
- `%LOCALAPPDATA%\DownFlow\jobs\<job-id>.log` — per-download yt-dlp output.

## Uninstall

```powershell
npm run native:uninstall
```

This removes the native-messaging registration and the copied helper. yt-dlp and
downloaded files are left in place; remove `%LOCALAPPDATA%\DownFlow` and
`Downloads\DownFlow` manually if you want them gone.

## Verification status

Verified in this workspace against a real Edge 156 session with the unpacked
extension and the installed helper:

- `site:status` returned the helper, yt-dlp 2026.10.26, FFmpeg 9.0.2 and the
  output folder.
- `site:probe` on `https://www.youtube.com/watch?v=jNQXAC9IVRw` returned the
  title **Me at the zoo** and 24 raw formats, normalized to 12 choices (4 video,
  8 audio). With FFmpeg present, video-only choices were marked downloadable.
- `site:start` with format `140-drc` downloaded a playable `.m4a` to
  `Downloads\DownFlow`, and the dashboard record reached **completed** with the
  correct `outputPath` and byte count.
- `site:start` with the merged video format `230+bestaudio/best` and
  `siteMerge: true` completed through the real extension. The resulting 252,182-byte
  MP4 was inspected with FFmpeg and contains both an H.264 video stream
  (320x240, 15 fps) and an Opus audio stream (48 kHz stereo).
- The `.m4a` output was inspected on disk and had a valid M4A header and the
  expected size.

Not verified: live streams, DRM-protected services, sites that require a login,
and Chrome-restart recovery while a site job is running. DownFlow reports those
cases as unsupported/errors rather than claiming success.
