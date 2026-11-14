import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clipboard,
  FolderOpen,
  Pause,
  Play,
  RotateCcw,
  Square,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import type { DownloadRecord } from '../shared/types';
import { CATEGORY_LABELS } from '../shared/constants';
import {
  formatBytes,
  formatEta,
  formatSpeed,
  progressPercent,
  timeAgo,
} from '../shared/utilities';
import { FileTile, ProgressBar, StatusTag } from './components';

export type DownloadAction = 'pause' | 'resume' | 'cancel' | 'retry' | 'remove' | 'open' | 'show' | 'copy';

const PRIORITY_LABELS = ['Low', 'Normal', 'High'];

function kindLabel(record: DownloadRecord): string {
  if (record.kind === 'segmented') {
    return record.segments.length > 1 ? `${record.segments.length} segments` : 'Segmented';
  }
  if (record.kind === 'hls') return 'HLS assembly';
  if (record.kind === 'dash') return 'DASH assembly';
  if (record.kind === 'site') {
    if (record.siteStage === 'merging') return 'Merging with FFmpeg';
    if (record.siteStage === 'finalizing') return 'Finishing video';
    return record.siteFormatLabel ? `Site video · ${record.siteFormatLabel}` : 'Site video';
  }
  return 'Chrome engine';
}

function ActionButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`icon-btn ${danger ? 'danger' : ''}`}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function DownloadCard({
  record,
  onAction,
  onPriority,
  onMove,
  queueIndex,
  queueLength,
}: {
  record: DownloadRecord;
  onAction: (action: DownloadAction, record: DownloadRecord) => Promise<void> | void;
  onPriority?: (record: DownloadRecord, priority: number) => Promise<void> | void;
  onMove?: (record: DownloadRecord, direction: -1 | 1) => Promise<void> | void;
  queueIndex?: number;
  queueLength?: number;
}): React.JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  const percent = progressPercent(record);
  const terminal = record.status === 'completed';
  const running = record.status === 'downloading' || record.status === 'probing';
  const canPause = running && record.kind !== 'hls' && record.kind !== 'dash';
  const canCancel = !terminal && record.status !== 'cancelled';
  const canResume = record.status === 'paused';
  const canRetry = record.status === 'failed' || record.status === 'cancelled';
  const canOpen = terminal && (Boolean(record.chromeDownloadId) || Boolean(record.outputPath));
  const isQueued = record.status === 'queued';
  const showPriority = isQueued && Boolean(onPriority);
  const showReorder = isQueued && Boolean(onMove);

  const run = async (action: DownloadAction): Promise<void> => {
    if (busy) return;
    setBusy(action);
    try {
      await onAction(action, record);
    } finally {
      setBusy(null);
    }
  };

  const secondary = (() => {
    if (record.status === 'downloading' || record.status === 'probing') {
      if (record.kind === 'site' && record.siteStage === 'merging') {
        return <span>Downloading streams complete — merging audio and video with FFmpeg…</span>;
      }
      if (record.kind === 'site' && record.siteStage === 'finalizing') {
        return <span>Finalizing the video file…</span>;
      }
      return (
        <>
          <span className="progress-pct">{percent.toFixed(percent >= 10 ? 0 : 1)}%</span>
          <span className="progress-speed">{formatSpeed(record.speedBps)}</span>
          <span className="progress-eta">ETA {formatEta(record.etaSeconds)}</span>
        </>
      );
    }
    if (record.status === 'paused') {
      return (
        <>
          <span className="progress-pct">{percent.toFixed(percent >= 10 ? 0 : 1)}%</span>
          <span>{formatBytes(record.downloadedBytes)} of {record.totalBytes > 0 ? formatBytes(record.totalBytes) : 'unknown size'}</span>
        </>
      );
    }
    if (record.status === 'queued') {
      return (
        <>
          <span>
            Waiting in queue{typeof queueIndex === 'number' ? ` · position ${queueIndex + 1} of ${queueLength ?? queueIndex + 1}` : ''}
          </span>
          {record.priority > 0 ? <span className="chip brand">{PRIORITY_LABELS[record.priority]}</span> : null}
        </>
      );
    }
    if (record.status === 'completed') {
      return (
        <>
          <span className="chip success">
            <CheckCircle2 size={11} /> Saved
          </span>
          <span>{formatBytes(record.totalBytes || record.downloadedBytes)}</span>
          <span>Finished {timeAgo(record.completedAt ?? record.updatedAt)}</span>
        </>
      );
    }
    if (record.status === 'delivering') {
      return <span>Handing the assembled file to Chrome…</span>;
    }
    if (record.status === 'failed' || record.status === 'cancelled') {
      return (
        <>
          <span>{formatBytes(record.downloadedBytes)} received</span>
          <span>{record.attempts > 0 ? `${record.attempts} attempt${record.attempts === 1 ? '' : 's'}` : 'Not completed'}</span>
        </>
      );
    }
    return <span>Preparing…</span>;
  })();

  return (
    <article className={`download-card ${record.status}`} aria-label={record.filename}>
      <FileTile record={record} />
      <div className="download-body">
        <div className="download-heading">
          <div className="download-name-wrap">
            <div className="download-name" title={record.filename}>
              {record.filename}
            </div>
            <div className="download-sub">
              <span>{record.sourceDomain || 'unknown source'}</span>
              <span className="sep">·</span>
              <span>{CATEGORY_LABELS[record.category]}</span>
              <span className="sep">·</span>
              <span>{kindLabel(record)}</span>
              {record.recovered ? (
                <>
                  <span className="sep">·</span>
                  <span className="chip warning">Recovered</span>
                </>
              ) : null}
              {record.fallbackReason ? (
                <>
                  <span className="sep">·</span>
                  <span className="chip warning" title={record.fallbackReason}>
                    Standard mode
                  </span>
                </>
              ) : null}
            </div>
          </div>
          <StatusTag status={record.status} />
        </div>

        {record.totalBytes > 0 && record.status !== 'queued' ? (
          <div className="progress-meta" style={{ gap: 6 }}>
            <span className="muted tiny mono">
              {formatBytes(record.downloadedBytes)} / {formatBytes(record.totalBytes)}
            </span>
            <span className="muted tiny mono">{percent.toFixed(1)}%</span>
          </div>
        ) : null}

        <ProgressBar record={record} />

        {record.error ? <div className="download-error" title={record.error}>{record.error}</div> : null}

        <div className="download-footer">
          <div className="meta-line">{secondary}</div>
          <div className="download-actions">
            {showReorder ? (
              <>
                <ActionButton
                  label="Move up in queue"
                  onClick={() => void onMove?.(record, -1)}
                  disabled={busy !== null || queueIndex === 0}
                >
                  <ArrowUp size={15} />
                </ActionButton>
                <ActionButton
                  label="Move down in queue"
                  onClick={() => void onMove?.(record, 1)}
                  disabled={busy !== null || queueIndex === (queueLength ?? 1) - 1}
                >
                  <ArrowDown size={15} />
                </ActionButton>
              </>
            ) : null}
            {showPriority ? (
              <div className="queue-controls" title="Queue priority">
                <select
                  className="select"
                  value={record.priority}
                  aria-label="Queue priority"
                  onChange={(event) => void onPriority?.(record, Number(event.target.value))}
                >
                  <option value={0}>Low</option>
                  <option value={1}>Normal</option>
                  <option value={2}>High</option>
                </select>
              </div>
            ) : null}
            {canPause ? (
              <ActionButton label="Pause download" onClick={() => void run('pause')} disabled={busy !== null}>
                <Pause size={15} />
              </ActionButton>
            ) : null}
            {canResume ? (
              <ActionButton label="Resume download" onClick={() => void run('resume')} disabled={busy !== null}>
                <Play size={15} />
              </ActionButton>
            ) : null}
            {canRetry ? (
              <ActionButton label="Retry download" onClick={() => void run('retry')} disabled={busy !== null}>
                <RotateCcw size={15} />
              </ActionButton>
            ) : null}
            {canCancel ? (
              <ActionButton label="Cancel download" onClick={() => void run('cancel')} disabled={busy !== null} danger>
                <Square size={14} />
              </ActionButton>
            ) : null}
            {canOpen ? (
              <ActionButton label="Open file" onClick={() => void run('open')} disabled={busy !== null}>
                <ExternalLink size={15} />
              </ActionButton>
            ) : null}
            {canOpen ? (
              <ActionButton label="Show in folder" onClick={() => void run('show')} disabled={busy !== null}>
                <FolderOpen size={15} />
              </ActionButton>
            ) : null}
            <ActionButton label="Copy download URL" onClick={() => void run('copy')} disabled={busy !== null}>
              <Clipboard size={14} />
            </ActionButton>
            <ActionButton label="Remove from DownFlow" onClick={() => void run('remove')} disabled={busy !== null} danger>
              <Trash2 size={14} />
            </ActionButton>
          </div>
        </div>
      </div>
    </article>
  );
}
