# DownFlow browser smoke report

Generated: 2026-11-14T18:54:11.867Z

Browser: Edg/157.0.4341.46

Extension: DownFlow - Download Manager (gcamajdjhipmfceelhpcjeddjneojoib, UNPACKED)

Result: PASS - 15/15 checks passed

| Check | Result | Detail |
| --- | --- | --- |
| Popup renders without runtime errors | PASS | 234 characters rendered |
| Dashboard renders all primary navigation | PASS | all navigation labels present |
| Background API returns persisted settings | PASS | theme=dark |
| Background API reports version and capabilities | PASS | version=1.0.0 |
| Download list endpoint returns a valid shape | PASS | 0 records |
| Media library endpoint returns a valid shape | PASS | 0 resources |
| Statistics endpoint derives data from stored records | PASS | totalDownloads=0 |
| Scheduler persists and deletes a schedule | PASS | schedule d30c7591-3425-4235-a391-cbd7c916fda2 |
| Native download starts through Chrome Downloads | PASS | download 9705eb7e-26e5-4026-a1c5-401e3a48e331 |
| Native download completes and writes the file | PASS | status=completed, bytes=131072/131072, files=1 |
| Settings write persists across calls | PASS | notifications=true |
| Segmented download settings can be enabled | PASS | segmentedEnabled=true |
| Range probe reports segmented support from the service worker | PASS | supported=true, bytes=5242880 |
| Segmented download is accepted by the coordinator | PASS | download 46ba4bf1-e203-4027-80be-1d3dae423648 |
| Segmented engine downloads, assembles and delivers the file | PASS | status=completed, kind=segmented, segments=2, bytes=5242880/5242880, file=5242880, name=downflow-segmented.bin, delivery=downflow-segmented.bin, path=%USERPROFILE%\AppData\Local\Temp\opencode\downflow-smoke-downloads-9473\downflow-segmented.bin, chromeId=2, tree=[downflow-segmented.bin:5242880] |

## Scope

This test loads the production `dist/` build into a real Chromium browser and exercises
the popup, dashboard, background message API, scheduler persistence, settings persistence,
a native Chrome Downloads transfer, and a full segmented Range/OPFS transfer (probe,
concurrent segments, assembly, and file delivery) against a local HTTP server.

It does not replace the manual checklist in `docs/CHROME_VERIFICATION.md`. Site detection,
media capture, HLS/DASH assembly, service-worker suspension, and Chrome restart recovery
still need a real browsing session to verify end to end.

## Browser attempts

- C:\Program Files\Google\Chrome\Application\chrome.exe: extension not loaded (branded build may block --load-extension)
