# Firefox status

DownFlow's current build is a **Chrome/Chromium Manifest V3 extension**. It
cannot be installed in Mozilla Firefox as-is, and renaming the `.zip`, changing
`manifest_version`, or using a Chrome-extension converter will not make it work.

This page records why, and what a real Firefox port would involve. It is not a
claim that a port exists.

## What happens if you try

- `about:debugging` → **This Firefox** → **Load Temporary Add-on** only accepts a
  manifest Firefox understands. The current `dist/manifest.json` uses
  `background.service_worker`, which Firefox does not run for extensions.
- Even after changing the background entry, Firefox lacks `chrome.offscreen` and
  `chrome.sidePanel`, which DownFlow uses for segmented/media downloads and the
  side-panel dashboard.
- Native messaging is registered differently: Chrome uses
  `allowed_origins` with `chrome-extension://<id>/`, while Firefox uses
  `allowed_extensions` with a Gecko add-on ID. The current helper manifest and
  Windows registry key target Chrome only.

## Concrete blockers in this codebase

| Area | Chrome-only piece | Firefox equivalent needed |
| --- | --- | --- |
| Background | `background.service_worker` + ES module service worker (`public/manifest.json`) | Event page (`background.scripts` / `background.page`), message handlers that survive suspension |
| Segmented / media engine | `chrome.offscreen` document (`src/background/offscreen-manager.ts`, `src/offscreen/offscreen.ts`) | Move fetch/OPFS/Blob work into the background page or a dedicated worker; replace `chrome.offscreen` messaging |
| Dashboard side panel | `chrome.sidePanel` (`src/background/service-worker.ts`) | Firefox sidebar API (`sidebar_action`), or keep the dashboard tab-only |
| Downloads integration | `chrome.downloads` promise-style calls and Chrome download-item fields | Firefox `browser.downloads` plus a compatibility layer; some fields/events differ |
| Native helper | `allowed_origins`, `HKCU\Software\Google\Chrome\NativeMessagingHosts\...` | `allowed_extensions`, `HKCU\Software\Mozilla\NativeMessagingHosts\com.downflow.helper`, Gecko add-on ID |
| Packaging | Unpacked Chrome folder / Chrome Web Store ZIP | `browser_specific_settings.gecko.id`, `web-ext build`, signing through AMO for permanent install |

The UI and most storage code (React, IndexedDB, settings, statistics, scheduler)
is portable. The download engines and background lifecycle are the expensive
parts, and they are the core of the product, so this is a port rather than a
five-minute manifest tweak.

## What you can do today

1. Install the current build in Chrome, Edge, Brave, Chromium or Vivaldi using
   [WINDOWS_INSTALL.md](WINDOWS_INSTALL.md).
2. In Firefox, keep using its built-in downloader. DownFlow cannot manage
   Firefox downloads or run its native helper there.

## If a Firefox build is wanted

A Firefox target would need, at minimum:

1. A separate manifest generated at build time (event page, `sidebar_action`,
   Gecko ID, Firefox permissions, no `offscreen`/`sidePanel`).
2. An offscreen replacement that runs the segmented and media engines in the
   background context, with tests for suspension and restart.
3. A native-messaging variant of `scripts/native-install.mjs` and
   `native/host.mjs` that registers under Mozilla's registry key with
   `allowed_extensions`.
4. A Firefox smoke run using `web-ext run` and a signed build for normal
   installation.

Until those exist, claiming Firefox support would be inaccurate.
