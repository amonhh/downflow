import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  CalendarClock,
  CheckCircle2,
  Download,
  ExternalLink,
  FolderOpen,
  Gauge,
  Link2,
  ListOrdered,
  Maximize2,
  Pause,
  Play,
  Plus,
  Settings as SettingsIcon,
  Square,
  Video,
  XCircle,
} from 'lucide-react';
import type { DownloadRecord } from '../shared/types';
import {
  formatBytes,
  formatEta,
  formatSpeed,
  isVideoPageUrl,
  progressPercent,
  validateDownloadUrl,
} from '../shared/utilities';
import { startDownload, useDownloads, useSettings } from '../ui/api';
import { FileTile, Logo, StatusTag } from '../ui/components';
import { ToastStack, useToasts } from '../ui/Toast';
import { applyTheme } from '../ui/theme';
import {
  pauseQueue,
  performDownloadAction,
  resumeQueue,
  startQueue,
  stopQueue,
} from '../ui/download-actions';

function QuickCard({
  record,
  busy,
  onAction,
}: {
  record: DownloadRecord;
  busy: boolean;
  onAction: (action: 'pause' | 'resume' | 'cancel' | 'open' | 'show') => void;
}): React.JSX.Element {
  const running = record.status === 'downloading' || record.status === 'probing';
  const percent = progressPercent(record);
  const canOpen = record.status === 'completed' && (Boolean(record.chromeDownloadId) || Boolean(record.outputPath));
  const stageLabel =
    record.siteStage === 'merging'
      ? 'Merging audio + video…'
      : record.siteStage === 'finalizing'
        ? 'Finishing file…'
        : null;
  return (
    <div className="popup-card">
      <FileTile record={record} />
      <div className="popup-card-body">
        <div className="popup-card-name" title={record.filename}>{record.filename}</div>
        <div className="popup-card-meta">
          <StatusTag status={record.status} />
          {stageLabel ? <span>{stageLabel}</span> : null}
          {running && !stageLabel ? <span>{formatSpeed(record.speedBps)}</span> : null}
          {running && !stageLabel ? <span>ETA {formatEta(record.etaSeconds)}</span> : null}
          {record.status === 'queued' ? <span>Waiting</span> : null}
          {record.status === 'paused' ? <span>{percent.toFixed(0)}%</span> : null}
          {record.status === 'completed' ? <span>{formatBytes(record.totalBytes || record.downloadedBytes)}</span> : null}
          {record.status === 'failed' ? <span className="truncate" title={record.error}>{record.error ?? 'Failed'}</span> : null}
        </div>
        {record.status !== 'completed' ? (
          <div className="progress" aria-hidden="true">
            <div className="progress-fill" style={{ width: `${percent}%` }} />
          </div>
        ) : null}
      </div>
      <div className="row" style={{ gap: 1, alignItems: 'flex-start' }}>
        {running && record.kind !== 'hls' && record.kind !== 'dash' ? (
          <button className="icon-btn" type="button" title="Pause" aria-label="Pause download" disabled={busy} onClick={() => onAction('pause')}>
            <Pause size={14} />
          </button>
        ) : null}
        {record.status === 'paused' ? (
          <button className="icon-btn" type="button" title="Resume" aria-label="Resume download" disabled={busy} onClick={() => onAction('resume')}>
            <Play size={14} />
          </button>
        ) : null}
        {canOpen ? (
          <>
            <button className="icon-btn" type="button" title="Open file" aria-label="Open file" disabled={busy} onClick={() => onAction('open')}>
              <ExternalLink size={14} />
            </button>
            <button className="icon-btn" type="button" title="Show in folder" aria-label="Show in folder" disabled={busy} onClick={() => onAction('show')}>
              <FolderOpen size={14} />
            </button>
          </>
        ) : null}
        {record.status !== 'completed' && record.status !== 'cancelled' ? (
          <button className="icon-btn danger" type="button" title="Cancel" aria-label="Cancel download" disabled={busy} onClick={() => onAction('cancel')}>
            <Square size={12} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function PopupApp(): React.JSX.Element {
  const { data, loading, error, refresh } = useDownloads(1000);
  const { settings } = useSettings();
  const { toasts, notify, dismiss } = useToasts();
  const [url, setUrl] = useState('');
  const [tabUrl, setTabUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  useEffect(() => applyTheme(settings.theme), [settings.theme]);

  useEffect(() => {
    let active = true;
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => {
        if (active && tab?.url) setTabUrl(tab.url);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const downloads = data.downloads;
  const active = downloads.filter(
    (record) => record.status === 'downloading' || record.status === 'probing' || record.status === 'delivering',
  );
  const queued = downloads.filter((record) => record.status === 'queued');
  const recent = downloads
    .filter((record) => !active.some((item) => item.id === record.id) && !queued.some((item) => item.id === record.id))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 4);
  const shown = [...active, ...queued].slice(0, 5);

  const openDashboard = (hash: string): void => {
    const suffix = hash ? `#${hash}` : '';
    void chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html${suffix}`) });
    window.close();
  };

  const openAdd = (target: string): void => {
    const hash = `all?add=${encodeURIComponent(target)}`;
    void chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html#${hash}`) });
    window.close();
  };

  const typedVideoPage = Boolean(url.trim()) && isVideoPageUrl(url.trim());
  const videoPage = typedVideoPage ? url.trim() : isVideoPageUrl(tabUrl) ? tabUrl : '';

  const add = async (addToQueue = false): Promise<void> => {
    const validation = validateDownloadUrl(url);
    if (!validation.valid || !validation.url) {
      notify(validation.reason ?? 'Enter a valid HTTP or HTTPS link.', 'error');
      return;
    }
    if (isVideoPageUrl(validation.url)) {
      openAdd(validation.url);
      return;
    }
    setBusy(true);
    try {
      const result = await startDownload({ url: validation.url, source: 'popup', addToQueue });
      setUrl('');
      notify(result.queued ? 'Added to the queue.' : `Started “${result.record.filename}”.`, 'success');
      await refresh();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Could not start the download.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const queue = async (kind: 'pause' | 'resume' | 'start' | 'stop'): Promise<void> => {
    setBusy(true);
    try {
      if (kind === 'pause') await pauseQueue();
      else if (kind === 'resume') await resumeQueue();
      else if (kind === 'start') await startQueue();
      else await stopQueue();
      await refresh();
      notify(
        kind === 'pause'
          ? 'Queue paused.'
          : kind === 'resume'
            ? 'Queue resumed.'
            : kind === 'start'
              ? 'Queue started.'
              : 'Queue stopped.',
        'success',
      );
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'The queue action failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const act = async (record: DownloadRecord, action: 'pause' | 'resume' | 'cancel' | 'open' | 'show'): Promise<void> => {
    setActionBusy(record.id);
    try {
      await performDownloadAction(action, record);
      await refresh();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'The download action failed.', 'error');
    } finally {
      setActionBusy(null);
    }
  };

  const categories = useMemo(() => new Set(downloads.map((record) => record.category)).size, [downloads]);

  if (loading && downloads.length === 0) {
    return (
      <div className="popup-root loading">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="popup-root">
      <header className="popup-header">
        <Logo compact />
        <div className="popup-header-actions">
          <button className="icon-btn" type="button" title="Open dashboard" aria-label="Open dashboard" onClick={() => openDashboard('')}>
            <Maximize2 size={15} />
          </button>
          <button className="icon-btn" type="button" title="Settings" aria-label="Settings" onClick={() => openDashboard('settings')}>
            <SettingsIcon size={15} />
          </button>
        </div>
      </header>

      <div className="popup-body">
        {error ? <div className="error-box">{error}</div> : null}

        <form className="popup-add" onSubmit={(event) => { event.preventDefault(); void add(); }}>
          <div className="input-group">
            <Link2 size={14} className="muted" style={{ alignSelf: 'center', marginLeft: 9, marginRight: -25, zIndex: 1 }} />
            <input
              className="input"
              style={{ paddingLeft: 30 }}
              type="url"
              inputMode="url"
              placeholder="Paste a download or video link…"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              aria-label="Download URL"
            />
          </div>
          {videoPage ? (
            <div className="help-box" style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
              <Video size={18} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ color: 'var(--text)' }}>{typedVideoPage ? 'Video page detected' : 'Video on this tab'}</strong>
                <div className="tiny muted truncate" title={videoPage}>
                  Choose a format and quality in the dashboard. Requires the optional local helper.
                </div>
              </div>
              <button className="btn btn-primary btn-sm" type="button" onClick={() => openAdd(videoPage)}>
                Formats
              </button>
            </div>
          ) : null}
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-primary btn-sm grow" type="submit" disabled={busy || !url.trim()}>
              {busy ? (
                <span className="spinner" style={{ width: 13, height: 13 }} />
              ) : videoPage ? (
                <Video size={14} />
              ) : (
                <Download size={14} />
              )}{' '}
              {videoPage ? 'Choose quality' : 'Download'}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              disabled={busy || !url.trim() || Boolean(videoPage)}
              onClick={() => void add(true)}
              title="Add to the queue without starting now"
            >
              <ListOrdered size={14} /> Queue
            </button>
          </div>
        </form>

        <div className="popup-stats">
          <div className="popup-stat">
            <span>Speed</span>
            <strong>{formatSpeed(data.activeSpeedBps)}</strong>
          </div>
          <div className="popup-stat">
            <span>Active</span>
            <strong>{active.length}</strong>
          </div>
          <div className="popup-stat">
            <span>Queued</span>
            <strong>{queued.length}</strong>
          </div>
        </div>

        <div className="popup-section-head">
          <h2>Queue controls</h2>
          <span className={data.queuePaused ? 'chip paused' : 'chip success'}>
            <span className="dot" /> {data.queuePaused ? 'Paused' : 'Running'}
          </span>
        </div>
        <div className="popup-controls">
          {data.queuePaused ? (
            <button className="btn btn-secondary btn-sm grow" type="button" disabled={busy} onClick={() => void queue('resume')}>
              <Play size={13} /> Resume queue
            </button>
          ) : (
            <button className="btn btn-secondary btn-sm grow" type="button" disabled={busy} onClick={() => void queue('pause')}>
              <Pause size={13} /> Pause queue
            </button>
          )}
          <button className="btn btn-secondary btn-sm grow" type="button" disabled={busy} onClick={() => void queue('start')}>
            <ArrowDownToLine size={13} /> Start
          </button>
          <button className="icon-btn danger" type="button" title="Stop queue" aria-label="Stop queue" disabled={busy} onClick={() => void queue('stop')}>
            <Square size={12} />
          </button>
        </div>

        <div className="popup-section-head">
          <h2>{active.length > 0 ? 'Active & queued' : 'Recent downloads'}</h2>
          <span className="popup-running">
            <Gauge size={12} /> {downloads.length} tracked
          </span>
        </div>

        <div className="popup-list">
          {shown.length === 0 && recent.length === 0 ? (
            <div className="popup-empty">
              <Download size={20} style={{ marginBottom: 6 }} />
              <div>No downloads yet.</div>
              <div className="tiny">Paste a direct link above to get started.</div>
            </div>
          ) : null}
          {shown.map((record) => (
            <QuickCard key={record.id} record={record} busy={actionBusy === record.id} onAction={(action) => void act(record, action)} />
          ))}
          {shown.length === 0
            ? recent.map((record) => (
                <QuickCard key={record.id} record={record} busy={actionBusy === record.id} onAction={(action) => void act(record, action)} />
              ))
            : null}
        </div>

        {shown.length > 0 && recent.length > 0 ? (
          <>
            <div className="popup-section-head">
              <h2>Recently finished</h2>
            </div>
            <div className="popup-list">
              {recent.map((record) => (
                <QuickCard key={record.id} record={record} busy={actionBusy === record.id} onAction={(action) => void act(record, action)} />
              ))}
            </div>
          </>
        ) : null}

        <div className="popup-running">
          <CheckCircle2 size={12} /> {downloads.filter((record) => record.status === 'completed').length} completed ·{' '}
          <XCircle size={12} /> {downloads.filter((record) => record.status === 'failed').length} failed · {categories} types
        </div>
      </div>

      <footer className="popup-footer">
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => openDashboard('')}>
          <Plus size={14} /> Dashboard
        </button>
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => openDashboard('scheduler')}>
          <CalendarClock size={14} /> Scheduler
        </button>
      </footer>

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
