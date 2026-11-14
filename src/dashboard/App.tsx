import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Download,
  Film,
  FolderTree,
  LayoutDashboard,
  ListOrdered,
  Menu,
  PauseCircle,
  PlayCircle,
  Plus,
  Search,
  Settings as SettingsIcon,
  XCircle,
} from 'lucide-react';
import type { FileCategory } from '../shared/types';
import { computeStats } from '../shared/stats';
import { formatSpeed } from '../shared/utilities';
import { DownloadsPage, type DownloadGroup } from '../ui/DownloadsPage';
import { AddDownloadModal } from '../ui/AddDownloadModal';
import { Logo } from '../ui/components';
import { ToastStack, useToasts } from '../ui/Toast';
import { applyTheme } from '../ui/theme';
import {
  pauseQueue,
  resumeQueue,
  startQueue,
  stopQueue,
} from '../ui/download-actions';
import { useDownloads, useInfo, useSettings, useHashRoute } from '../ui/api';
import { OverviewPage } from './pages/OverviewPage';
import { MediaPage } from './pages/MediaPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { SchedulerPage } from './pages/SchedulerPage';
import { SettingsPage } from './pages/SettingsPage';
import { StatisticsPage } from './pages/StatisticsPage';

const DOWNLOAD_ROUTES: Record<string, DownloadGroup> = {
  all: 'all',
  downloading: 'downloading',
  queued: 'queued',
  completed: 'completed',
  paused: 'paused',
  failed: 'failed',
};

/** Reads an `add=<url>` hint from the hash route or the page query string. */
function readAddHint(): string | undefined {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  const search = window.location.search.replace(/^\?/, '');
  const params = new URLSearchParams(hashQuery || search);
  const url = params.get('add');
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}

const TITLES: Record<string, string> = {
  overview: 'Overview',
  all: 'All Downloads',
  downloading: 'Downloading',
  queued: 'Queued',
  completed: 'Completed',
  paused: 'Paused',
  failed: 'Failed',
  media: 'Video & Audio',
  categories: 'Categories',
  scheduler: 'Scheduler',
  settings: 'Settings',
  statistics: 'Statistics',
};

export function DashboardApp(): React.JSX.Element {
  const { route, navigate } = useHashRoute('overview');
  const { data, loading, error, refresh } = useDownloads();
  const { settings, save } = useSettings();
  const { info, refresh: refreshInfo } = useInfo();
  const { toasts, notify, dismiss } = useToasts();
  const [globalSearch, setGlobalSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<FileCategory | 'all'>('all');
  const [initialUrl, setInitialUrl] = useState<string | undefined>(() => readAddHint());
  const [adding, setAdding] = useState(() => Boolean(readAddHint()));
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => applyTheme(settings.theme), [settings.theme]);

  useEffect(() => {
    if (!window.location.hash.includes('add=')) return;
    const clean = window.location.hash.replace(/^#\/?/, '').split('?')[0] || 'overview';
    window.history.replaceState(null, '', `#${clean}`);
  }, []);

  const base = route.split(/[/?]/)[0] || 'overview';
  const downloads = data.downloads;
  const stats = useMemo(() => computeStats(downloads), [downloads]);

  const counts = useMemo(() => {
    const value = {
      all: downloads.length,
      downloading: 0,
      queued: 0,
      completed: 0,
      paused: 0,
      failed: 0,
      media: info?.media ?? 0,
    };
    for (const record of downloads) {
      if (record.status === 'downloading' || record.status === 'probing' || record.status === 'delivering') value.downloading += 1;
      else if (record.status === 'queued') value.queued += 1;
      else if (record.status === 'completed') value.completed += 1;
      else if (record.status === 'paused') value.paused += 1;
      else if (record.status === 'failed' || record.status === 'cancelled') value.failed += 1;
    }
    return value;
  }, [downloads, info?.media]);

  const go = (next: string): void => {
    navigate(next);
    setSidebarOpen(false);
  };

  const queueToggle = async (): Promise<void> => {
    try {
      if (data.queuePaused) await resumeQueue();
      else await pauseQueue();
      await refresh();
      notify(data.queuePaused ? 'Queue resumed.' : 'Queue paused. Active transfers continue.', 'success');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Could not change the queue.', 'error');
    }
  };

  const startNow = async (): Promise<void> => {
    try {
      await startQueue();
      await refresh();
      notify('Queue started.', 'success');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Could not start the queue.', 'error');
    }
  };

  const stopAll = async (): Promise<void> => {
    try {
      await stopQueue();
      await refresh();
      notify('Queue stopped and active downloads cancelled.', 'success');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Could not stop the queue.', 'error');
    }
  };

  const navItem = (id: string, label: string, icon: typeof Download, count?: number): React.JSX.Element => {
    const Icon = icon;
    return (
      <button
        key={id}
        type="button"
        className={`nav-item ${base === id ? 'active' : ''}`}
        onClick={() => go(id)}
        aria-current={base === id ? 'page' : undefined}
      >
        <Icon />
        <span>{label}</span>
        {typeof count === 'number' && count > 0 ? <span className="nav-count">{count}</span> : null}
      </button>
    );
  };

  const downloadGroup = DOWNLOAD_ROUTES[base] ?? null;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <Logo />
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
          <div className="nav-section-label">Dashboard</div>
          <nav className="nav-list" aria-label="Dashboard">
            {navItem('overview', 'Overview', LayoutDashboard)}
          </nav>

          <div className="nav-section-label">Downloads</div>
          <nav className="nav-list" aria-label="Downloads">
            {navItem('all', 'All downloads', Download, counts.all)}
            {navItem('downloading', 'Downloading', Activity, counts.downloading)}
            {navItem('queued', 'Queued', ListOrdered, counts.queued)}
            {navItem('completed', 'Completed', CheckCircle2, counts.completed)}
            {navItem('paused', 'Paused', PauseCircle, counts.paused)}
            {navItem('failed', 'Failed', XCircle, counts.failed)}
          </nav>

          <div className="nav-section-label">Library</div>
          <nav className="nav-list" aria-label="Library">
            {navItem('media', 'Video & audio', Film, counts.media)}
            {navItem('categories', 'Categories', FolderTree)}
            {navItem('statistics', 'Statistics', BarChart3)}
          </nav>

          <div className="nav-section-label">Tools</div>
          <nav className="nav-list" aria-label="Tools">
            {navItem('scheduler', 'Scheduler', CalendarClock)}
            {navItem('settings', 'Settings', SettingsIcon)}
          </nav>
        </div>

        <div className="sidebar-footer">
          <div className="speed-pill">
            <span className={`dot ${data.activeSpeedBps > 0 ? 'pulse' : ''}`} />
            <span>{data.activeSpeedBps > 0 ? formatSpeed(data.activeSpeedBps) : 'Idle'}</span>
            <strong>{counts.downloading} active</strong>
          </div>
          <div className="sidebar-footnote">
            Runs locally in Chrome. No account, no cloud.
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-btn mobile-menu-btn"
            type="button"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label="Toggle navigation"
          >
            <Menu size={17} />
          </button>
          <div className="topbar-search">
            <Search />
            <input
              className="input"
              placeholder="Search filename, source, type or URL…"
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              aria-label="Global download search"
            />
          </div>
          <div className="topbar-actions">
            <button
              className={`queue-pill ${data.queuePaused ? 'paused' : ''}`}
              type="button"
              onClick={() => void queueToggle()}
              title={data.queuePaused ? 'Resume the download queue' : 'Pause the download queue'}
            >
              <span className="dot" />
              {data.queuePaused ? 'Queue paused' : `${counts.queued} queued`}
            </button>
            <button className="icon-btn" type="button" title="Start queue" aria-label="Start queue" onClick={() => void startNow()}>
              <PlayCircle size={16} />
            </button>
            <button className="icon-btn" type="button" title="Stop queue" aria-label="Stop queue" onClick={() => void stopAll()}>
              <PauseCircle size={16} />
            </button>
            <button className="btn btn-primary btn-sm" type="button" onClick={() => setAdding(true)}>
              <Plus size={15} /> Add
            </button>
          </div>
        </header>

        <main className="content">
          {error ? <div className="error-box">{error}</div> : null}
          {base !== 'overview' && base !== 'settings' && base !== 'statistics' && (
            <div className="list-summary" style={{ marginBottom: -10 }}>
              <span className="tiny muted">
                {TITLES[base] ?? 'DownFlow'} · {formatSpeed(data.activeSpeedBps)}
              </span>
              <span className={data.queuePaused ? 'chip paused' : 'chip success'}>
                <span className="dot" /> {data.queuePaused ? 'Queue paused' : 'Queue active'}
              </span>
            </div>
          )}

          {base === 'overview' ? (
            <OverviewPage
              downloads={downloads}
              stats={stats}
              queuePaused={data.queuePaused}
              settings={settings}
              onAdd={() => setAdding(true)}
              onNavigate={go}
              onRefresh={refresh}
              notify={notify}
            />
          ) : downloadGroup ? (
            <DownloadsPage
              group={downloadGroup}
              downloads={downloads}
              queuePaused={data.queuePaused}
              loading={loading}
              error={null}
              globalSearch={globalSearch}
              categoryFilter={categoryFilter}
              onCategoryFilterChange={setCategoryFilter}
              onAdd={() => setAdding(true)}
              onRefresh={refresh}
              notify={notify}
            />
          ) : base === 'media' ? (
            <MediaPage
              notify={notify}
              onStarted={() => {
                void refresh();
                void refreshInfo();
              }}
            />
          ) : base === 'categories' ? (
            <CategoriesPage
              downloads={downloads}
              settings={settings}
              save={save}
              notify={notify}
              onFilter={(category) => {
                setCategoryFilter(category);
                go('all');
              }}
            />
          ) : base === 'scheduler' ? (
            <SchedulerPage notify={notify} onChanged={refresh} />
          ) : base === 'settings' ? (
            <SettingsPage
              settings={settings}
              save={save}
              info={info}
              refreshInfo={refreshInfo}
              notify={notify}
            />
          ) : base === 'statistics' ? (
            <StatisticsPage stats={stats} info={info} />
          ) : (
            <div className="panel panel-pad">
              <h1>Page not found</h1>
              <p className="muted">Return to the overview to continue.</p>
              <button className="btn btn-primary" type="button" onClick={() => go('overview')} style={{ marginTop: 12 }}>
                <LayoutDashboard size={15} /> Back to overview
              </button>
            </div>
          )}
        </main>
      </div>

      {adding ? (
        <AddDownloadModal
          initialUrl={initialUrl}
          source="dashboard"
          onClose={() => {
            setAdding(false);
            setInitialUrl(undefined);
          }}
          onStarted={(result) => {
            setInitialUrl(undefined);
            notify(
              result.queued
                ? `Added “${result.record.filename}” to the queue.`
                : `Started “${result.record.filename}”.`,
              'success',
            );
            void refresh();
            go('all');
          }}
        />
      ) : null}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
