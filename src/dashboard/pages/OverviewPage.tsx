import {
  Activity,
  ArrowDownToLine,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Download,
  FolderTree,
  Gauge,
  ListOrdered,
  PauseCircle,
  Play,
  Square,
  XCircle,
} from 'lucide-react';
import type { AppSettings, DownloadRecord, StatsSummary } from '../../shared/types';
import { CATEGORY_LABELS } from '../../shared/constants';
import {
  formatBytes,
  formatSpeed,
} from '../../shared/utilities';
import { DownloadCard, type DownloadAction } from '../../ui/DownloadCard';
import { CategoryDonut, WeekChart } from '../../ui/Charts';
import { EmptyState } from '../../ui/components';
import {
  pauseAll,
  pauseQueue,
  performDownloadAction,
  resumeAll,
  resumeQueue,
  startQueue,
  stopQueue,
} from '../../ui/download-actions';
import type { ToastKind } from '../../ui/Toast';

export function OverviewPage({
  downloads,
  stats,
  queuePaused,
  settings,
  onAdd,
  onNavigate,
  onRefresh,
  notify,
}: {
  downloads: DownloadRecord[];
  stats: StatsSummary;
  queuePaused: boolean;
  settings: AppSettings;
  onAdd: () => void;
  onNavigate: (route: string) => void;
  onRefresh: () => Promise<void>;
  notify: (message: string, kind?: ToastKind) => void;
}): React.JSX.Element {
  const active = downloads
    .filter((record) => record.status === 'downloading' || record.status === 'probing' || record.status === 'delivering')
    .sort((a, b) => (b.startedAt ?? b.updatedAt) - (a.startedAt ?? a.updatedAt))
    .slice(0, 4);

  const recent = [...downloads]
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((record) => !active.some((item) => item.id === record.id))
    .slice(0, 4);

  const runAction = async (action: DownloadAction, record: DownloadRecord): Promise<void> => {
    if (action === 'remove') {
      const confirmed = window.confirm(
        record.status === 'completed'
          ? `Remove “${record.filename}” from DownFlow history?\n\nThe saved file is not deleted.`
          : `Remove “${record.filename}” and cancel the transfer?`,
      );
      if (!confirmed) return;
    }
    try {
      await performDownloadAction(action, record);
      await onRefresh();
      if (action === 'copy') notify('Download link copied.', 'success');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'The action failed.', 'error');
    }
  };

  const queueAction = async (kind: 'start' | 'pause-queue' | 'resume-queue' | 'stop' | 'pause-all' | 'resume-all'): Promise<void> => {
    try {
      if (kind === 'start') await startQueue();
      else if (kind === 'pause-queue') await pauseQueue();
      else if (kind === 'resume-queue') await resumeQueue();
      else if (kind === 'stop') await stopQueue();
      else if (kind === 'pause-all') await pauseAll();
      else await resumeAll();
      await onRefresh();
      notify(
        kind === 'start'
          ? 'Queue started.'
          : kind === 'stop'
            ? 'Queue stopped.'
            : kind === 'pause-all'
              ? 'Active downloads paused.'
              : kind === 'resume-all'
                ? 'Paused downloads resumed.'
                : kind === 'pause-queue'
                  ? 'Queue paused. No new downloads will start.'
                  : 'Queue resumed.',
        'success',
      );
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'The queue action failed.', 'error');
    }
  };

  const activeCount = stats.activeDownloads;
  const storagePct =
    stats.totalDownloadedBytes > 0
      ? Math.round((stats.totalDownloadedBytes / (stats.totalDownloadedBytes + 1)) * 100)
      : 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>
            {activeCount > 0
              ? `${activeCount} active download${activeCount === 1 ? '' : 's'} · ${formatSpeed(stats.speedBps)}`
              : 'Everything is quiet. Add a link or let the queue run.'}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" type="button" onClick={() => void queueAction('pause-all')}>
            <PauseCircle size={15} /> Pause all
          </button>
          <button className="btn btn-primary" type="button" onClick={onAdd}>
            <Download size={15} /> Add download
          </button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card accent">
          <div className="stat-icon"><Activity /></div>
          <span className="stat-label">Active downloads</span>
          <span className="stat-value">{stats.activeDownloads}</span>
          <span className="stat-hint">{formatSpeed(stats.speedBps)} combined</span>
        </div>
        <div className="stat-card green">
          <div className="stat-icon"><CheckCircle2 /></div>
          <span className="stat-label">Completed</span>
          <span className="stat-value">{stats.completedDownloads}</span>
          <span className="stat-hint">{stats.downloadsToday} added today</span>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><ArrowDownToLine /></div>
          <span className="stat-label">Downloaded</span>
          <span className="stat-value">{formatBytes(stats.totalDownloadedBytes)}</span>
          <span className="stat-hint">Across completed files</span>
        </div>
        <div className="stat-card amber">
          <div className="stat-icon"><ListOrdered /></div>
          <span className="stat-label">Waiting in queue</span>
          <span className="stat-value">{stats.queuedDownloads}</span>
          <span className="stat-hint">Limit {settings.maxConcurrent} at a time</span>
        </div>
      </div>

      <div className="overview-grid">
        <div className="stack-gap">
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Active downloads</h2>
                <p>Live speed and segment progress from the engine.</p>
              </div>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => onNavigate('downloading')}>
                View all
              </button>
            </div>
            <div className="panel-body">
              {active.length === 0 ? (
                <EmptyState
                  icon={Activity}
                  title="No active transfers"
                  description="Start a download or resume something paused. DownFlow shows real bytes, speed and ETA here."
                >
                  <button className="btn btn-primary" type="button" onClick={onAdd}>
                    <Download size={15} /> Add download
                  </button>
                </EmptyState>
              ) : (
                <div className="download-list">
                  {active.map((record) => (
                    <DownloadCard key={record.id} record={record} onAction={runAction} />
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Recent downloads</h2>
                <p>Your latest transfers, newest first.</p>
              </div>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => onNavigate('all')}>
                Open list
              </button>
            </div>
            <div className="panel-body">
              {recent.length === 0 ? (
                <p className="muted small">No other downloads yet.</p>
              ) : (
                <div className="download-list">
                  {recent.map((record) => (
                    <DownloadCard key={record.id} record={record} onAction={runAction} />
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="stack-gap">
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Queue</h2>
                <p>{queuePaused ? 'Paused — nothing new will start.' : 'Running automatically.'}</p>
              </div>
              <span className={queuePaused ? 'chip paused' : 'chip success'}>
                <span className="dot" /> {queuePaused ? 'Paused' : 'Active'}
              </span>
            </div>
            <div className="panel-body stack-gap">
              <div className="quick-actions">
                {queuePaused ? (
                  <button className="btn btn-primary btn-sm" type="button" onClick={() => void queueAction('resume-queue')}>
                    <Play size={14} /> Resume queue
                  </button>
                ) : (
                  <button className="btn btn-secondary btn-sm" type="button" onClick={() => void queueAction('pause-queue')}>
                    <PauseCircle size={14} /> Pause queue
                  </button>
                )}
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => void queueAction('start')}>
                  <ArrowDownToLine size={14} /> Start queue
                </button>
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => void queueAction('stop')}>
                  <Square size={13} /> Stop
                </button>
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => void queueAction('resume-all')}>
                  <Play size={14} /> Resume all
                </button>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => onNavigate('queued')}>
                  Manage queue
                </button>
              </div>
              <div className="quick-stat-list">
                <div className="quick-stat-row">
                  <span className="muted">Queued</span>
                  <strong>{stats.queuedDownloads}</strong>
                </div>
                <div className="quick-stat-row">
                  <span className="muted">Paused</span>
                  <strong>{stats.pausedDownloads}</strong>
                </div>
                <div className="quick-stat-row">
                  <span className="muted">Failed</span>
                  <strong>{stats.failedDownloads}</strong>
                </div>
                <div className="quick-stat-row">
                  <span className="muted">Concurrent limit</span>
                  <strong>{settings.maxConcurrent}</strong>
                </div>
                <div className="quick-stat-row">
                  <span className="muted">Connections per file</span>
                  <strong>{settings.segmentCount}</strong>
                </div>
              </div>
              <div className="queue-mini">
                <span className="chip brand">
                  <Gauge size={11} /> {stats.speedBps > 0 ? formatSpeed(stats.speedBps) : 'Idle'}
                </span>
                <span className="chip">
                  <Clock3 size={11} /> {stats.downloadsThisWeek} this week
                </span>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Last 7 days</h2>
                <p>Downloads added, from stored history.</p>
              </div>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => onNavigate('statistics')}>
                Statistics
              </button>
            </div>
            <div className="panel-body">
              <WeekChart days={stats.last7Days} />
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>By category</h2>
                <p>Every stored download, grouped by file type.</p>
              </div>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => onNavigate('categories')}>
                Folders
              </button>
            </div>
            <div className="panel-body">
              <CategoryDonut counts={stats.categoryCounts} />
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Quick actions</h2>
                <p>Shortcuts to the tools you use most.</p>
              </div>
            </div>
            <div className="panel-body quick-actions">
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => onNavigate('media')}>
                <Play size={14} /> Video &amp; audio
              </button>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => onNavigate('scheduler')}>
                <CalendarClock size={14} /> Scheduler
              </button>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => onNavigate('categories')}>
                <FolderTree size={14} /> Categories
              </button>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => onNavigate('failed')}>
                <XCircle size={14} /> Failed ({stats.failedDownloads})
              </button>
            </div>
          </section>
        </div>
      </div>

      <div className="list-summary">
        <span>
          <strong>{stats.totalDownloads}</strong> stored downloads · {stats.downloadsThisMonth} this month ·{' '}
          {stats.mostCommonType ? `mostly ${CATEGORY_LABELS[stats.mostCommonType.category]}` : 'no dominant type'}
        </span>
        <span className="muted tiny">
          DownFlow stores metadata locally. {storagePct > 0 ? 'Files stay in Chrome’s download folder.' : ''}
        </span>
      </div>
    </>
  );
}
