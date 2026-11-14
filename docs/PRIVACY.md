# DownFlow Privacy Policy

**Effective date:** 14 November 2026
**Publisher:** _[your name or company]_
**Contact:** _[your support email]_

DownFlow is a browser extension that manages downloads locally on your device.
This policy explains what it handles and what it does not.

## Summary

- DownFlow has no account, no ads, no analytics and no telemetry.
- Download history, settings, schedules and statistics stay in your browser
  profile.
- The publisher does not receive your data and operates no server for the
  extension.
- The extension does not sell, rent or share data with data brokers or
  advertisers.

## Data DownFlow handles on your device

To provide its single purpose, DownFlow processes and stores:

- URLs you choose to download, file names, sizes, progress and status
- Download history, categories, schedules and statistics
- Extension settings and theme choice
- Media metadata detected in network requests on pages you visit, so the media
  picker can list downloadable formats
- Clipboard text only when you explicitly use a copy action

This information is stored in the browser's local storage and IndexedDB. It is
not transmitted to the publisher.

## Network requests

DownFlow contacts only the sites you download from (or the sites serving media
you ask it to detect or save), using your existing browser session where the
site requires it. These requests are necessary to perform the download you
requested. The publisher does not receive copies of those requests or their
contents.

The optional native helper runs yt-dlp locally and contacts the video site you
ask it to download from. It does not send your data to the publisher. yt-dlp is
a separate open-source program installed by you; review its behavior and the
site's terms before using it.

## Permissions

DownFlow requests browser permissions only for its download-management features:

- downloads, storage and unlimited storage: manage and remember downloads
- tabs and side panel: open the dashboard and work with the active page
- context menus and notifications: user-initiated actions and completion alerts
- alarms: schedules and retry timers
- offscreen: segmented/media downloads and clipboard actions without a visible page
- webRequest: observe media request metadata; requests are not modified or blocked
- clipboardWrite: copy a link when you ask
- nativeMessaging: optional communication with the locally installed helper
  (the extension works without it)
- host permissions for all sites: you can download from any URL, and media can
  be detected on any site you visit

## Data sharing

DownFlow does not share data with the publisher or third parties. Data leaves
your device only as part of the network requests needed for a download you
started, or when you use the optional helper, which contacts the site being
downloaded.

## Retention and deletion

Data remains in your browser profile until you delete it. You can remove
individual records in the dashboard, clear history in settings, or uninstall the
extension to remove its browser storage. The optional helper keeps job logs and
downloads under `%LOCALAPPDATA%\DownFlow` and your chosen output folder; remove
them with `npm run native:uninstall` and by deleting those folders.

## Children

DownFlow is a general-purpose utility and is not directed at children. It does
not knowingly collect personal information from anyone.

## Changes

If this policy changes, the updated version will be published at this URL with a
new effective date. Material changes will be noted in the extension's release
notes.

## Contact

Questions about this policy: _[your support email]_.

DownFlow does not bypass DRM, paywalls or login restrictions. Only download
content you have permission to save.
