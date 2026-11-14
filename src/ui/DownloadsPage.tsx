import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  CheckCircle2,
  Download,
  ListOrdered,
  PauseCircle,
  Search,
  XCircle,
} from 'lucide-react';
import type { DownloadRecord, FileCategory } from '../shared/types';
import { CATEGORY_LABELS } from '../shared/constants';
import { formatBytes, progressPercent, statusGroup } from '../shared/utilities';
import { DownloadCard, type DownloadAction } from './DownloadCard';
import { EmptyState } from './components';
import {
  performDownloadAction,
  reorderQueue,
  resumeAll,
  pauseAll,
  setDownloadPriority,
  startQueue,
} from './download-actions';
import type { ToastKind } from './Toast';

export type DownloadGroup = 'all' | 'downloading' | 'queued' | 'completed' | 'paused' | 'failed';

const GROUP_META: Record<
  DownloadGroup,
  { title: string; subtitle: string; emptyTitle: string; emptyDescription: string; icon: typeof Download }
> = {
  all: {
    title: 'All Downloads',
    subtitle: 'Every transfer stored locally by DownFlow.',
    emptyTitle: 'No downloads yet',
    emptyDescription: 'Paste a direct file URL or use the DownFlow menu on any download link.',
    icon: Download,
  },
  downloading: {
    title: 'Downloading',
    subtitle: 'Transfers currently running through Chrome or the segmented engine.',
    emptyTitle: 'Nothing is downloading',
    emptyDescription: 'Start a download or resume a paused transfer to see live speed, progress and ETA here.',
    icon: ArrowDownToLine,
  },
  queued: {
    title: 'Queued',
    subtitle: 'Waiting transfers ordered by priority. Reorder and tune priority here.',
    emptyTitle: 'The queue is empty',
    emptyDescription: 'Add links to the queue or start more downloads. DownFlow respects your concurrent download limit.',
    icon: ListOrdered,
  },
  completed: {
    title: 'Completed',
    subtitle: 'Files saved through Chrome. Open them or reveal them in their folder.',
    emptyTitle: 'No completed downloads',
    emptyDescription: 'Finished downloads will appear here with their real saved size.',
    icon: CheckCircle2,
  },
  paused: {
    title: 'Paused',
    subtitle: 'Transfers you can resume without losing completed bytes where possible.',
    emptyTitle: 'No paused downloads',
    emptyDescription: 'Pause a running transfer to keep it here for later.',
    icon: PauseCircle,
  },
  failed: {
    title: 'Failed',
    subtitle: 'Interrupted or rejected transfers with their actual error messages.',
    emptyTitle: 'No failed downloads',
    emptyDescription: 'Errors such as authentication failures, missing Range support or disk problems appear here.',
    icon: XCircle,
  },
};

type SortKey = 'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'size-desc' | 'size-asc' | 'type' | 'progress';

function categoryOf(record: DownloadRecord): FileCategory {
  return record.category;
}

export function DownloadsPage({
  group,
  downloads,
  queuePaused,
  loading,
  error,
  globalSearch,
  categoryFilter,
  onCategoryFilterChange,
  onAdd,
  onRefresh,
  notify,
}: {
  group: DownloadGroup;
  downloads: DownloadRecord[];
  queuePaused: boolean;
  loading: boolean;
  error: string | null;
  globalSearch: string;
  categoryFilter: FileCategory | 'all';
  onCategoryFilterChange: (category: FileCategory | 'all') => void;
  onAdd: () => void;
  onRefresh: () => Promise<void>;
  notify: (message: string, kind?: ToastKind) => void;
}): React.JSX.Element {
  const meta = GROUP_META[group];
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | DownloadGroup>('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [sort, setSort] = useState<SortKey>('newest');

  useEffect(() => {
    setStatusFilter('all');
  }, [group]);

  const sources = useMemo(
    () => Array.from(new Set(downloads.map((record) => record.sourceDomain).filter(Boolean))).sort(),
    [downloads],
  );

  const filtered = useMemo(() => {
    const query = `${globalSearch} ${search}`.trim().toLowerCase();
    const records = downloads.filter((record) => {
      if (group !== 'all') {
        if (group === 'failed') {
          if (statusGroup(record) !== 'failed') return false;
        } else if (statusGroup(record) !== group) {
          return false;
        }
      }
      if (statusFilter !== 'all' && statusGroup(record) !== statusFilter) return false;
      if (categoryFilter !== 'all' && categoryOf(record) !== categoryFilter) return false;
      if (sourceFilter !== 'all' && record.sourceDomain !== sourceFilter) return false;
      if (!query) return true;
      const haystack = `${record.filename} ${record.sourceDomain} ${record.category} ${record.url} ${record.mime}`.toLowerCase();
      return query.split(/\s+/).every((part) => haystack.includes(part));
    });
    return records.sort((a, b) => {
      switch (sort) {
        case 'oldest':
          return a.createdAt - b.createdAt;
        case 'name-asc':
          return a.filename.localeCompare(b.filename);
        case 'name-desc':
          return b.filename.localeCompare(a.filename);
        case 'size-desc':
          return b.totalBytes - a.totalBytes || b.downloadedBytes - a.downloadedBytes;
        case 'size-asc':
          return a.totalBytes - b.totalBytes || a.downloadedBytes - b.downloadedBytes;
        case 'type':
          return a.category.localeCompare(b.category) || a.filename.localeCompare(b.filename);
        case 'progress':
          return progressPercent(b) - progressPercent(a);
        case 'newest':
        default:
          return b.createdAt - a.createdAt;
      }
    });
  }, [categoryFilter, downloads, globalSearch, group, search, sort, sourceFilter, statusFilter]);

  const queuedSorted = useMemo(
    () =>
      downloads
        .filter((record) => record.status === 'queued')
        .sort((a, b) => b.priority - a.priority || a.queueOrder - b.queueOrder || a.createdAt - b.createdAt),
    [downloads],
  );

  const totalBytes = filtered.reduce((sum, record) => sum + (record.totalBytes || record.downloadedBytes), 0);

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
      if (action === 'copy') notify('Download link copied to the clipboard.', 'success');
      else if (action === 'remove') notify('Download removed from DownFlow.', 'success');
      else if (action === 'retry') notify('Download queued for another attempt.');
      else if (action === 'pause') notify('Download paused.');
      else if (action === 'resume') notify('Download resumed.');
      else if (action === 'cancel') notify('Download cancelled.');
      await onRefresh();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'The download action failed.', 'error');
    }
  };

  const move = async (record: DownloadRecord, direction: -1 | 1): Promise<void> => {
    const index = queuedSorted.findIndex((item) => item.id === record.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= queuedSorted.length) return;
    const ids = queuedSorted.map((item) => item.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await reorderQueue(ids);
      await onRefresh();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Could not reorder the queue.', 'error');
    }
  };

  const changePriority = async (record: DownloadRecord, priority: number): Promise<void> => {
    try {
      await setDownloadPriority(record, priority);
      await onRefresh();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Could not change priority.', 'error');
    }
  };

  const bulk = async (kind: 'pause' | 'resume' | 'start'): Promise<void> => {
    try {
      if (kind === 'start') await startQueue();
      else if (kind === 'pause') await pauseAll();
      else await resumeAll();
      notify(kind === 'start' ? 'Queue started.' : kind === 'pause' ? 'Active downloads paused.' : 'Downloads resumed.');
      await onRefresh();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'The queue action failed.', 'error');
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{meta.title}</h1>
          <p>{meta.subtitle}</p>
        </div>
        <div className="page-actions">
          {group === 'queued' ? (
            <>
              <button className="btn btn-secondary" type="button" onClick={() => void bulk('pause')} disabled={queuePaused}>
                <PauseCircle size={15} /> Pause queue
              </button>
              <button className="btn btn-primary" type="button" onClick={() => void bulk('start')}>
                <ArrowDownToLine size={15} /> Start queue
              </button>
            </>
          ) : null}
          {group === 'downloading' ? (
            <button className="btn btn-secondary" type="button" onClick={() => void bulk('pause')}>
              <PauseCircle size={15} /> Pause all
            </button>
          ) : null}
          {group === 'paused' ? (
            <button className="btn btn-primary" type="button" onClick={() => void bulk('resume')}>
              <ArrowDownToLine size={15} /> Resume all
            </button>
          ) : null}
          <button className="btn btn-primary" type="button" onClick={onAdd}>
            <Download size={15} /> Add download
          </button>
        </div>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      <div className="toolbar">
        <div className="search-field">
          <Search />
          <input
            className="input"
            placeholder="Search filename, source site, type or URL…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search downloads"
          />
        </div>
        {group === 'all' ? (
          <select
            className="select"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as 'all' | DownloadGroup)}
            aria-label="Filter by status"
          >
            <option value="all">Any status</option>
            <option value="downloading">Downloading</option>
            <option value="queued">Queued</option>
            <option value="completed">Completed</option>
            <option value="paused">Paused</option>
            <option value="failed">Failed</option>
          </select>
        ) : null}
        <select
          className="select"
          value={categoryFilter}
          onChange={(event) => onCategoryFilterChange(event.target.value as FileCategory | 'all')}
          aria-label="Filter by category"
        >
          <option value="all">All categories</option>
          {(Object.keys(CATEGORY_LABELS) as FileCategory[]).map((category) => (
            <option key={category} value={category}>
              {CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
        <select
          className="select"
          value={sourceFilter}
          onChange={(event) => setSourceFilter(event.target.value)}
          aria-label="Filter by source site"
        >
          <option value="all">Any source site</option>
          {sources.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
        <select className="select" value={sort} onChange={(event) => setSort(event.target.value as SortKey)} aria-label="Sort downloads">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name-asc">Name A–Z</option>
          <option value="name-desc">Name Z–A</option>
          <option value="size-desc">Largest size</option>
          <option value="size-asc">Smallest size</option>
          <option value="type">File type</option>
          <option value="progress">Progress</option>
        </select>
        <span className="toolbar-count">
          {filtered.length} shown · {formatBytes(totalBytes)}
        </span>
      </div>

      <div className="list-summary">
        <span>
          <strong>{filtered.length}</strong> download{filtered.length === 1 ? '' : 's'}
          {categoryFilter !== 'all' ? ` in ${CATEGORY_LABELS[categoryFilter]}` : ''}
        </span>
        <span className={queuePaused ? 'chip paused' : 'chip success'}>
          <span className="dot" /> Queue {queuePaused ? 'paused' : 'active'}
        </span>
      </div>

      {loading && downloads.length === 0 ? (
        <div className="panel panel-pad loading-screen">
          <div className="spinner" />
          Loading your downloads…
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={meta.icon}
            title={meta.emptyTitle}
            description={meta.emptyDescription}
          >
            <button className="btn btn-primary" type="button" onClick={onAdd}>
              <Download size={15} /> Add a download
            </button>
          </EmptyState>
        </div>
      ) : (
        <div className="download-list">
          {filtered.map((record) => {
            const queueIndex = record.status === 'queued' ? queuedSorted.findIndex((item) => item.id === record.id) : undefined;
            return (
              <DownloadCard
                key={record.id}
                record={record}
                onAction={runAction}
                onPriority={changePriority}
                onMove={move}
                queueIndex={queueIndex}
                queueLength={queuedSorted.length}
              />
            );
          })}
        </div>
      )}
    </>
  );
}
