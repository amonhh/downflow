# Chrome Web Store submission guide

This covers packaging and listing DownFlow. It does **not** guarantee approval.
Read the policy-risk section before submitting; it is the most important part.

## What users need after publication

| Feature | Requirement |
| --- | --- |
| Core extension (queue, downloads, scheduling, history, media detection) | Chrome/Chromium 116+ on desktop. One click from the store; **no Node.js or npm**. |
| Video-site downloads (YouTube and similar) | Optional local helper: Node.js, yt-dlp, and usually FFmpeg. This is installed separately by the user and is **not** inside the store package. |
| Firefox | Not supported by this build. See [FIREFOX.md](FIREFOX.md). |
| ChromeOS / mobile Chrome | No native helper, so video-site downloads are unavailable. Mobile Chrome does not run extensions. |

The store package alone is a complete download manager. The helper only unlocks
yt-dlp-backed site downloads.

## Build the upload archive

```powershell
npm run package:store
```

This runs the production build, verifies the required files, and writes:

```text
release\downflow-1.0.0-chrome.zip
```

Upload that ZIP file. The ZIP already contains `manifest.json` at its root; do
not zip the `dist` folder itself and do not upload the folder.

## Before you upload

- [ ] Register a Chrome Web Store developer account (one-time fee) and enable
      2-Step Verification.
- [ ] Host a privacy policy URL publicly. [PRIVACY.md](PRIVACY.md) is ready to
      publish, for example on GitHub Pages or your own site.
- [ ] Prepare at least one screenshot at **1280×800** (or 640×400) PNG/JPEG.
      Suggested shots: dashboard downloads list, media/quality picker, settings.
- [ ] Prepare the 128×128 store icon. `dist/icons/icon-128.png` can be reused.
- [ ] Decide whether to submit with the video-site helper as a documented
      optional feature. Read the policy risk below first.
- [ ] Bump `version` in `public/manifest.json` for every later upload. The store
      rejects a duplicate version.

## Listing copy

**Name**

```text
DownFlow - Download Manager
```

**Short description** (under 132 characters)

```text
Queue, resume and organize downloads with media detection, plus optional local video-site support.
```

**Category:** Productivity

**Single purpose**

```text
DownFlow manages the user's downloads: it queues, resumes, organizes and tracks
files, detects downloadable media on pages the user visits, and can hand
supported video pages to an optional local helper.
```

**Detailed description**

```text
DownFlow is a local-first download manager for Chrome.

• Queue, pause, resume, cancel and retry downloads
• Organize files into categories with history and statistics
• Schedule downloads for later
• Detect media links on pages you visit
• Segmented downloading when the server supports HTTP Range requests
• Optional side-panel dashboard, popup controls and right-click actions
• Dark and light themes

Everything is stored locally in your browser profile. DownFlow has no account,
no analytics, no ads and no developer server. It does not bypass DRM, paywalls
or login restrictions.

Video-site downloads are optional and require a separate local helper
(Node.js + yt-dlp, and FFmpeg for merging separate streams). The extension
works without it. Only download media you have permission to save.
```

Do not claim "acceleration", "DRM removal", "bypass", or guaranteed speeds.
Segmented downloading only helps when the server supports ranges, and the UI
already reports when it does not.

## Permission justifications

The dashboard asks for a justification per permission. Suggested text:

| Permission | Justification |
| --- | --- |
| `downloads` | Start, pause, resume, cancel, open and reveal the user's downloads. |
| `storage`, `unlimitedStorage` | Keep queue state, settings and history locally; large media downloads need room. |
| `tabs` | Open the dashboard, detect the active tab's URL when the user starts a download, and support the side panel. |
| `contextMenus` | Add "Download with DownFlow" actions for links, images, media and pages. |
| `notifications` | Notify the user when downloads complete or fail. |
| `alarms` | Run scheduled downloads and retry/backoff timers. |
| `sidePanel` | Show the dashboard in Chrome's side panel when the user opens it. |
| `offscreen` | Run segmented/media fetches and clipboard writes without opening a visible page. |
| `webRequest` | Observe request metadata to detect media streams. DownFlow does not modify or block requests. |
| `clipboardWrite` | Copy a download link when the user chooses that action. |
| `nativeMessaging` | Optional communication with the user-installed local helper for video pages. The extension works without the helper. |
| `<all_urls>` host permission | Users can download from any URL and media can be detected on any site. No page content is sent to the developer. |

## Privacy practices answers

- No account, analytics, telemetry, ads or developer server.
- Download history, settings and statistics stay in the browser profile.
- URLs are sent only to the site being downloaded from, or to yt-dlp when the
  user starts a video-site download with the helper installed.
- The extension package contains no remote code, no `eval`, and no remotely
  fetched scripts.

Match the dashboard answers to [PRIVACY.md](PRIVACY.md). If the form's current
definition of "collection" differs, follow the official definition and keep the
policy and listing consistent.

## Policy risk: video downloading

Chrome Web Store policies state:

> Do not encourage, facilitate, or enable the unauthorized access, download, or
> streaming of copyrighted content or media.

Video downloaders are also explicitly excluded from being featured in the store,
although they are not categorically banned. In practice, extensions that
advertise YouTube downloading are regularly rejected or removed, and a rejection
can put the developer account under extra scrutiny.

DownFlow's current description and helper deliberately support YouTube and
similar sites. That is the largest approval risk in this submission. Options:

1. **Submit the full build and be transparent.** Best functionality, highest
   review risk. Do not hide the helper in the listing; hiding it can be treated
   as misleading metadata.
2. **Submit a store edition without video-site downloads.** Build a variant that
   omits the helper, `nativeMessaging` permission and YouTube/site picker, and
   keep the full build for direct distribution. Lower risk, but it is a
   different product surface and needs its own testing.
3. **Keep the extension off-store** and distribute the unpacked/enterprise
   build. No review risk, but users must enable developer mode and install the
   helper manually.

There is no wording trick that makes copyright risk disappear. Decide which
trade-off you want before uploading.

## After approval: extension ID and the helper

The store assigns a different extension ID from your unpacked build. The native
helper manifest must allow that exact ID.

1. Copy the published ID from the developer dashboard.
2. Reinstall/register the helper against it:

   ```powershell
   npm run native:install -- --extension-id=<published-id>
   ```

3. For end users, the helper currently needs Node.js and a terminal. To ship a
   one-click experience you would need a signed helper installer that writes the
   same native-messaging manifest with the published ID. That installer is not
   part of this project yet.

If you want the unpacked and store builds to share one ID, add a `key` to the
manifest before the first upload. Otherwise keep the published ID in your
release notes and helper installer configuration.

## Upload steps

1. Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Create a new item and upload `release\downflow-<version>-chrome.zip`.
3. Fill in the listing, category, language, screenshots and privacy fields.
4. Add the privacy policy URL, support URL and homepage if available.
5. Submit for review. Answer reviewer questions; do not remove features just to
   make a review pass while leaving them active in the build.
6. After approval, install from the store in a clean profile and run the core
   download flow once.

## Post-approval smoke test

At minimum, in a clean Chrome profile with the store build:

1. Download a direct file and confirm it lands with the correct name.
2. Pause/resume, cancel and retry.
3. Create and delete a schedule.
4. Open the dashboard and side panel.
5. If the helper is installed with the store ID, probe and download one
   permitted video page; otherwise confirm the extension clearly says the helper
   is not installed.
