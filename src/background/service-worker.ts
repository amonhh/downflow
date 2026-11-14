import { DownloadCoordinator, SITE_POLL_ALARM } from './coordinator';
import { getHelperStatus, resetHelperConnection } from './site-helper';
import { mediaFromResponse, discoverMedia, enrichMedia } from './media-discovery';
import { copyTextWithOffscreen } from './offscreen-manager';
import { Scheduler, SCHEDULE_ALARM_PREFIX } from './scheduler';
import { probeRangeSupport } from '../engine/range-validator';
import type { AppRequest, DetectedMedia } from '../shared/types';
import { cleanErrorMessage, isVideoPageUrl, uuid } from '../shared/utilities';
import { deleteMedia, getMedia, listMedia, pruneMedia } from '../storage/media-store';

const RETRY_ALARM_PREFIX = 'downflow:retry:';
const MENU_DOWNLOAD = 'downflow-download-link';
const MENU_QUEUE = 'downflow-queue-link';
const MENU_SITE = 'downflow-site-quality';
const MENU_COPY = 'downflow-copy-link';
const MENU_DASHBOARD = 'downflow-open-dashboard';
const MENU_SIDEPANEL = 'downflow-open-sidepanel';

const coordinator = new DownloadCoordinator();
const scheduler = new Scheduler(coordinator);
const capturedMedia = new Set<string>();

let nativeSyncTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleNativeSync(): void {
  if (nativeSyncTimer) return;
  nativeSyncTimer = setTimeout(() => {
    nativeSyncTimer = undefined;
    void coordinator.handleChromeChanged().catch(() => undefined);
  }, 400);
}

function sendResponseSafely(sendResponse: (response: unknown) => void, response: unknown): void {
  try {
    sendResponse(response);
  } catch {
    // The requesting tab or page may have closed.
  }
}

async function handleRequest(request: AppRequest): Promise<unknown> {
  switch (request.type) {
    case 'downloads:list':
      return coordinator.list();
    case 'downloads:get':
      return coordinator.get(request.id);
    case 'downloads:start':
      return coordinator.startDownload(request.payload);
    case 'downloads:pause':
      return coordinator.pause(request.id);
    case 'downloads:resume':
      return coordinator.resume(request.id);
    case 'downloads:cancel':
      return coordinator.cancel(request.id);
    case 'downloads:retry':
      return coordinator.retry(request.id);
    case 'downloads:remove':
      await coordinator.remove(request.id);
      return true;
    case 'downloads:pause-all':
      return coordinator.pauseAll();
    case 'downloads:resume-all':
      return coordinator.resumeAll();
    case 'downloads:open':
      await coordinator.openFile(request.id);
      return true;
    case 'downloads:show':
      await coordinator.showInFolder(request.id);
      return true;
    case 'downloads:set-priority':
      await coordinator.setPriority(request.id, request.priority);
      return true;
    case 'downloads:reorder':
      await coordinator.reorder(request.ids);
      return true;
    case 'downloads:probe':
      return probeRangeSupport(request.url);
    case 'queue:pause':
      await coordinator.pauseQueue();
      return true;
    case 'queue:resume':
      await coordinator.resumeQueue();
      return true;
    case 'queue:start':
      await coordinator.startQueue(request.max);
      return true;
    case 'queue:stop':
      await coordinator.stopQueue();
      return true;
    case 'queue:reorder':
      await coordinator.reorder(request.ids);
      return true;
    case 'settings:get':
      return coordinator.getSettings();
    case 'settings:update':
      return coordinator.updateSettings(request.patch);
    case 'stats:get':
      return coordinator.getStats();
    case 'media:list': {
      await pruneMedia();
      return listMedia();
    }
    case 'media:remove': {
      await deleteMedia(request.id);
      return true;
    }
    case 'media:download':
      return coordinator.startMediaDownload(request.payload);
    case 'media:discovered':
      return discoverMedia(request.payload);
    case 'media:probe': {
      const resource = await getMedia(request.id);
      if (!resource) throw new Error('This media resource is no longer available.');
      await enrichMedia(resource);
      return (await getMedia(request.id)) ?? resource;
    }
    case 'site:status': {
      if (request.force) resetHelperConnection();
      return getHelperStatus(request.force);
    }
    case 'site:probe':
      return coordinator.probeSite(request.url);
    case 'site:start':
      return coordinator.startSiteDownload(request.payload);
    case 'site:sync':
      await coordinator.syncSiteJobs();
      return true;
    case 'detect:resource': {
      const probe = await probeRangeSupport(request.payload.url, {
        referer: request.payload.pageUrl,
      });
      return {
        ...probe,
        filename: probe.filename || request.payload.filename,
        pageUrl: request.payload.pageUrl,
        pageTitle: request.payload.pageTitle,
      };
    }
    case 'schedules:list':
      return scheduler.list();
    case 'schedules:create':
      return scheduler.create(request.payload);
    case 'schedules:update':
      return scheduler.update(request.id, request.payload);
    case 'schedules:delete':
      await scheduler.delete(request.id);
      return true;
    case 'schedules:run':
      return scheduler.runNow(request.id);
    case 'system:open-dashboard': {
      const suffix = request.page ? `#${request.page.replace(/^#/, '')}` : '';
      await chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html${suffix}`) });
      return true;
    }
    case 'system:clear-history':
      return coordinator.clearHistory();
    case 'system:clear-segments':
      await coordinator.clearSegments();
      return true;
    case 'system:get-info':
      return coordinator.getInfo();
    default:
      throw new Error(`Unsupported DownFlow request: ${(request as { type?: string }).type ?? 'unknown'}`);
  }
}

async function handleEngineMessage(type: string, payload: unknown): Promise<void> {
  switch (type) {
    case 'engine:progress':
      await coordinator.handleEngineProgress(payload as Parameters<DownloadCoordinator['handleEngineProgress']>[0]);
      return;
    case 'engine:complete':
      await coordinator.handleEngineComplete(payload as Parameters<DownloadCoordinator['handleEngineComplete']>[0]);
      return;
    case 'engine:error':
      await coordinator.handleEngineError(payload as Parameters<DownloadCoordinator['handleEngineError']>[0]);
      return;
    case 'engine:fallback':
      await coordinator.handleEngineFallback(payload as Parameters<DownloadCoordinator['handleEngineFallback']>[0]);
      return;
    case 'engine:paused':
      await coordinator.handleEnginePaused((payload as { downloadId: string }).downloadId);
      return;
    case 'engine:resumed':
      await coordinator.handleEngineResumed((payload as { downloadId: string }).downloadId);
      return;
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (!message || typeof message !== 'object') return false;
  const type = (message as { type?: unknown }).type;
  if (typeof type !== 'string') return false;

  if (type.startsWith('engine:')) {
    const payload = (message as { payload?: unknown }).payload;
    handleEngineMessage(type, payload)
      .then(() => sendResponseSafely(sendResponse, { ok: true, data: true }))
      .catch((error) =>
        sendResponseSafely(sendResponse, { ok: false, error: cleanErrorMessage(error), code: 'ENGINE_HANDLER_FAILED' }),
      );
    return true;
  }

  if (type.startsWith('offscreen:')) return false;

  handleRequest(message as AppRequest)
    .then((data) => sendResponseSafely(sendResponse, { ok: true, data }))
    .catch((error) => {
      const messageText = cleanErrorMessage(error);
      sendResponseSafely(sendResponse, {
        ok: false,
        error: messageText,
        code: (error as { code?: string })?.code,
      });
    });
  return true;
});

chrome.downloads.onCreated.addListener((item) => {
  void coordinator.handleChromeCreated(item).catch(() => undefined);
});

chrome.downloads.onChanged.addListener(() => {
  scheduleNativeSync();
});

chrome.downloads.onErased.addListener(() => {
  scheduleNativeSync();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith(RETRY_ALARM_PREFIX)) {
    const id = alarm.name.slice(RETRY_ALARM_PREFIX.length);
    void coordinator.autoRetry(id).catch(() => undefined);
    return;
  }
  if (alarm.name.startsWith(SCHEDULE_ALARM_PREFIX)) {
    void scheduler.handleAlarm(alarm.name).catch(() => undefined);
    return;
  }
  if (alarm.name === SITE_POLL_ALARM) {
    void coordinator.syncSiteJobs().catch(() => undefined);
  }
});

async function notifyError(title: string, message: string): Promise<void> {
  try {
    await chrome.notifications.create(`downflow-${uuid()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title,
      message: message.slice(0, 240),
      priority: 0,
    });
  } catch {
    // Notifications are optional.
  }
}

function buildContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create(
      {
        id: MENU_DOWNLOAD,
        title: 'Download with DownFlow',
        contexts: ['link'],
      },
      () => void chrome.runtime.lastError,
    );
    chrome.contextMenus.create(
      {
        id: MENU_QUEUE,
        title: 'Add link to DownFlow queue',
        contexts: ['link'],
      },
      () => void chrome.runtime.lastError,
    );
    chrome.contextMenus.create(
      {
        id: MENU_SITE,
        title: 'Choose video quality with DownFlow',
        contexts: ['page', 'video'],
        documentUrlPatterns: [
          '*://*.youtube.com/*',
          '*://youtu.be/*',
          '*://*.youtube-nocookie.com/*',
          '*://*.vimeo.com/*',
          '*://*.dailymotion.com/*',
          '*://*.tiktok.com/*',
          '*://*.instagram.com/*',
          '*://*.facebook.com/*',
          '*://*.x.com/*',
          '*://*.twitter.com/*',
          '*://*.twitch.tv/*',
          '*://*.reddit.com/*',
          '*://*.soundcloud.com/*',
          '*://*.bilibili.com/*',
          '*://*.rumble.com/*',
          '*://*.odysee.com/*',
        ],
      },
      () => void chrome.runtime.lastError,
    );
    chrome.contextMenus.create(
      {
        id: MENU_COPY,
        title: 'Copy download link',
        contexts: ['link', 'page'],
      },
      () => void chrome.runtime.lastError,
    );
    chrome.contextMenus.create(
      {
        id: MENU_DASHBOARD,
        title: 'Open DownFlow dashboard',
        contexts: ['action', 'page'],
      },
      () => void chrome.runtime.lastError,
    );
    chrome.contextMenus.create(
      {
        id: MENU_SIDEPANEL,
        title: 'Open DownFlow side panel',
        contexts: ['page'],
      },
      () => void chrome.runtime.lastError,
    );
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void (async () => {
    if (info.menuItemId === MENU_DASHBOARD) {
      await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
      return;
    }
    if (info.menuItemId === MENU_SIDEPANEL) {
      const windowId = tab?.windowId ?? (await chrome.windows.getCurrent()).id;
      if (typeof windowId === 'number') {
        await chrome.sidePanel.setOptions({ path: 'dashboard.html', enabled: true });
        await chrome.sidePanel.open({ windowId });
      }
      return;
    }
    if (info.menuItemId === MENU_SITE) {
      const url = info.pageUrl || tab?.url;
      if (!url) throw new Error('There is no page URL for this tab.');
      await chrome.tabs.create({
        url: chrome.runtime.getURL(`dashboard.html#all?add=${encodeURIComponent(url)}`),
      });
      return;
    }
    if (info.menuItemId === MENU_COPY) {
      const url = info.linkUrl || info.pageUrl;
      if (!url) throw new Error('There is no link to copy.');
      await copyTextWithOffscreen(url);
      return;
    }
    if (info.menuItemId === MENU_DOWNLOAD || info.menuItemId === MENU_QUEUE) {
      const url = info.linkUrl;
      if (!url) throw new Error('This context menu item needs a link.');
      if (isVideoPageUrl(url)) {
        await chrome.tabs.create({
          url: chrome.runtime.getURL(`dashboard.html#all?add=${encodeURIComponent(url)}`),
        });
        return;
      }
      const result = await coordinator.startDownload({
        url,
        pageUrl: info.pageUrl,
        pageTitle: tab?.title,
        source: 'context-menu',
        addToQueue: info.menuItemId === MENU_QUEUE,
      });
      if (!result.record) throw new Error('DownFlow could not create the download.');
    }
  })().catch((error) => {
    void notifyError('DownFlow could not start the download', cleanErrorMessage(error));
  });
});

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0 || !/^https?:/i.test(details.url)) return;
    const header = details.responseHeaders?.find((item) => item.name.toLowerCase() === 'content-type');
    const contentType = header?.value?.split(';')[0]?.trim() ?? '';
    if (!contentType) return;
    if (!/^(video|audio)\//i.test(contentType) && !/mpegurl|dash\+xml/i.test(contentType)) return;
    if (capturedMedia.has(details.url)) return;
    capturedMedia.add(details.url);
    if (capturedMedia.size > 500) capturedMedia.clear();
    void chrome.tabs
      .get(details.tabId)
      .then((tab) => {
        const detected: DetectedMedia | null = mediaFromResponse(details.url, contentType, tab.url, tab.title);
        if (!detected) return undefined;
        detected.kind = /mpegurl/i.test(contentType)
          ? 'hls'
          : /dash\+xml/i.test(contentType)
            ? 'dash'
            : detected.kind;
        return discoverMedia(detected);
      })
      .catch(() => undefined);
  },
  { urls: ['http://*/*', 'https://*/*'], types: ['media', 'object', 'xmlhttprequest', 'other'] },
  ['responseHeaders'],
);

chrome.notifications.onClicked.addListener((notificationId) => {
  if (!notificationId.startsWith('downflow-') && !notificationId.startsWith('media-')) return;
  void chrome.tabs.create({ url: chrome.runtime.getURL(notificationId.startsWith('media-') ? 'dashboard.html#media' : 'dashboard.html') });
  void chrome.notifications.clear(notificationId);
});

chrome.runtime.onInstalled.addListener((details) => {
  buildContextMenus();
  if (details.reason === 'install' || details.reason === 'update') {
    void coordinator
      .recoverOnStartup()
      .then(() => scheduler.resync())
      .catch(() => undefined);
  }
});

chrome.runtime.onStartup.addListener(() => {
  void coordinator
    .recoverOnStartup()
    .then(() => scheduler.resync())
    .catch(() => undefined);
});

void coordinator.initialize().catch(() => undefined);
void scheduler.resync().catch(() => undefined);
