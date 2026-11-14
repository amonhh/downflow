import { useMemo, useState } from 'react';
import {
  ExternalLink,
  Film,
  Link2,
  Music2,
  Play,
  Radio,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import type { MediaResource } from '../../shared/types';
import { formatBytes, formatDuration, timeAgo } from '../../shared/utilities';
import { sendRequest } from '../../shared/messaging';
import { useMedia } from '../../ui/api';
import { copyText } from '../../ui/download-actions';
import { EmptyState, Modal } from '../../ui/components';
import type { ToastKind } from '../../ui/Toast';

function kindIcon(kind: MediaResource['kind']) {
  if (kind === 'audio') return Music2;
  if (kind === 'hls' || kind === 'dash') return Radio;
  return Film;
}

function kindLabel(kind: MediaResource['kind']): string {
  if (kind === 'hls') return 'HLS playlist';
  if (kind === 'dash') return 'DASH manifest';
  if (kind === 'audio') return 'Audio file';
  if (kind === 'video') return 'Video file';
  return 'Media';
}

function variantLabel(resource: MediaResource, value: string): string {
  if (resource.kind === 'dash') {
    const representation = resource.representations?.find((item) => item.id === value);
    if (!representation) return value;
    const size = representation.width && representation.height ? `${representation.width}×${representation.height}` : representation.codecs || representation.mime;
    const rate = representation.bandwidth ? ` · ${Math.round(representation.bandwidth / 1000)} kbps` : '';
    return `${representation.type.toUpperCase()} · ${size}${rate}`;
  }
  const variant = resource.variants?.find((item) => item.uri === value);
  if (!variant) return value;
  return [variant.name, variant.resolution, variant.bandwidth ? `${Math.round(variant.bandwidth / 1000)} kbps` : null]
    .filter(Boolean)
    .join(' · ');
}

function resolutionScore(resolution?: string): number {
  const dimensions = resolution?.match(/(\d+)\s*[x×]\s*(\d+)/i);
  if (dimensions) return Number(dimensions[2]);
  const height = resolution?.match(/(\d+)\s*p/i);
  return height ? Number(height[1]) : 0;
}

function optionScore(resource: MediaResource, value: string): number {
  if (resource.kind === 'dash') {
    const representation = resource.representations?.find((item) => item.id === value);
    if (!representation) return 0;
    const typeScore = representation.type === 'video' ? 1e12 : representation.type === 'audio' ? 1e9 : 0;
    return typeScore + (representation.height ?? 0) * 1e6 + (representation.bandwidth ?? 0);
  }
  const variant = resource.variants?.find((item) => item.uri === value);
  if (!variant) return 0;
  return resolutionScore(variant.resolution) * 1e6 + (variant.bandwidth ?? 0);
}

function MediaCard({
  resource,
  notify,
  onRefresh,
  onStarted,
}: {
  resource: MediaResource;
  notify: (message: string, kind?: ToastKind) => void;
  onRefresh: () => Promise<void>;
  onStarted: () => void;
}): React.JSX.Element {
  const [selection, setSelection] = useState('');
  const [qualityOpen, setQualityOpen] = useState(false);
  const [busy, setBusy] = useState<'download' | 'probe' | 'remove' | null>(null);
  const Icon = kindIcon(resource.kind);

  const options = useMemo(() => {
    const raw = resource.kind === 'dash'
      ? (resource.representations ?? []).map((representation) => ({
          value: representation.id,
          label: variantLabel(resource, representation.id),
          score: optionScore(resource, representation.id),
        }))
      : (resource.variants ?? []).map((variant) => ({
          value: variant.uri,
          label: variantLabel(resource, variant.uri),
          score: optionScore(resource, variant.uri),
        }));
    return raw
      .sort((a, b) => b.score - a.score)
      .map(({ value, label }) => ({ value, label }));
  }, [resource]);

  const bestValue = options[0]?.value ?? '';
  const activeSelection = options.some((option) => option.value === selection) ? selection : bestValue;

  const run = async (kind: 'download' | 'probe' | 'remove'): Promise<void> => {
    if (busy) return;
    setBusy(kind);
    try {
      if (kind === 'download') {
        await sendRequest({
          type: 'media:download',
          payload: {
            mediaId: resource.id,
            ...(resource.kind === 'dash' ? { representationId: activeSelection } : { variantUri: activeSelection }),
          },
        });
        notify(`Added “${resource.title}” to the download queue.`, 'success');
        setQualityOpen(false);
        onStarted();
      } else if (kind === 'probe') {
        await sendRequest({ type: 'media:probe', id: resource.id });
        await onRefresh();
        notify('Media manifest information refreshed.', 'success');
      } else {
        if (!window.confirm(`Remove “${resource.title}” from detected media?`)) return;
        await sendRequest({ type: 'media:remove', id: resource.id });
        await onRefresh();
        notify('Detected media removed.', 'success');
      }
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'The media action failed.', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className="media-card">
      <div className="media-top">
        <div className={`media-kind ${resource.kind === 'audio' ? 'audio' : resource.kind === 'dash' ? 'dash' : ''}`}>
          <Icon size={19} />
        </div>
        <div className="grow">
          <div className="media-title" title={resource.title}>{resource.title || 'Untitled media'}</div>
          <div className="media-meta">
            <span>{resource.sourceDomain}</span>
            <span>·</span>
            <span>{kindLabel(resource.kind)}</span>
            {resource.duration ? (
              <>
                <span>·</span>
                <span>{formatDuration(resource.duration)}</span>
              </>
            ) : null}
            {resource.size > 0 ? (
              <>
                <span>·</span>
                <span>{formatBytes(resource.size)}</span>
              </>
            ) : null}
            <span>·</span>
            <span>{timeAgo(resource.discoveredAt)}</span>
          </div>
          {resource.pageTitle ? <div className="media-meta"><span className="truncate">{resource.pageTitle}</span></div> : null}
        </div>
      </div>

      {resource.protected ? (
        <div className="warning-box">
          <ShieldAlert size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
          DRM-protected stream{resource.protectionSystem ? ` (${resource.protectionSystem})` : ''} detected. DownFlow does
          not bypass DRM and will not download it.
        </div>
      ) : null}

      {options.length > 0 ? (
        <select
          className="select media-select"
          value={activeSelection}
          onChange={(event) => setSelection(event.target.value)}
          aria-label="Media quality or representation"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      ) : (
        <p className="muted tiny">
          {resource.kind === 'dash'
            ? 'No downloaded DASH representations are available. Try refreshing the manifest.'
            : 'No variant list was found. DownFlow can try the direct media URL.'}
        </p>
      )}

      <div className="media-actions">
        <button
          className="btn btn-primary btn-sm"
          type="button"
          onClick={() => {
            if (options.length > 1) setQualityOpen(true);
            else void run('download');
          }}
          disabled={Boolean(busy) || resource.protected}
          title={resource.protected ? 'DRM-protected media cannot be downloaded' : 'Choose quality and add to the DownFlow queue'}
        >
          {busy === 'download' ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <Play size={14} />}
          Download
        </button>
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => void run('probe')} disabled={Boolean(busy)}>
          <RefreshCw size={14} className={busy === 'probe' ? 'spin' : ''} /> Refresh
        </button>
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          disabled={Boolean(busy)}
          onClick={() => {
            void copyText(resource.url)
              .then(() => notify('Media URL copied.', 'success'))
              .catch((caught: unknown) => notify(caught instanceof Error ? caught.message : 'Clipboard blocked.', 'error'));
          }}
        >
          <Link2 size={14} /> Copy URL
        </button>
        {resource.pageUrl ? (
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={() => void chrome.tabs.create({ url: resource.pageUrl! })}
          >
            <ExternalLink size={14} /> Page
          </button>
        ) : null}
        <button
          className="icon-btn danger"
          type="button"
          title="Remove detected media"
          aria-label="Remove detected media"
          disabled={Boolean(busy)}
          onClick={() => void run('remove')}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {qualityOpen ? (
        <Modal
          title="Choose format & quality"
          subtitle={resource.title}
          onClose={() => setQualityOpen(false)}
          footer={
            <>
              <button className="btn btn-ghost" type="button" onClick={() => setQualityOpen(false)} disabled={busy === 'download'}>
                Cancel
              </button>
              <button className="btn btn-primary" type="button" onClick={() => void run('download')} disabled={busy === 'download'}>
                {busy === 'download' ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <Play size={15} />}
                Start download
              </button>
            </>
          }
        >
          <div className="quality-list" role="radiogroup" aria-label="Media format and quality">
            {options.map((option) => (
              <label key={option.value} className={`quality-option ${activeSelection === option.value ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name={`quality-${resource.id}`}
                  value={option.value}
                  checked={activeSelection === option.value}
                  onChange={() => setSelection(option.value)}
                />
                <span className="quality-label">{option.label}</span>
                {option.value === bestValue ? <span className="chip">Best</span> : null}
              </label>
            ))}
          </div>
          {resource.kind === 'dash' ? (
            <div className="help-box">
              DASH video and audio are separate tracks. Pick the track you want; DownFlow does not merge them.
            </div>
          ) : null}
          {resource.kind === 'hls' ? (
            <div className="help-box">
              HLS is saved by joining the accessible segments into a <span className="mono">.ts</span> file
              (<span className="mono">.mp4</span> for fragmented MP4 playlists).
            </div>
          ) : null}
        </Modal>
      ) : null}
    </article>
  );
}

export function MediaPage({
  notify,
  onStarted,
}: {
  notify: (message: string, kind?: ToastKind) => void;
  onStarted: () => void;
}): React.JSX.Element {
  const { media, loading, error, refresh } = useMedia();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'all' | MediaResource['kind']>('all');

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return media
      .filter((resource) => (kind === 'all' ? true : resource.kind === kind))
      .filter((resource) => {
        if (!query) return true;
        return `${resource.title} ${resource.sourceDomain} ${resource.pageTitle ?? ''} ${resource.mime}`.toLowerCase().includes(query);
      })
      .sort((a, b) => b.discoveredAt - a.discoveredAt);
  }, [kind, media, search]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Video &amp; audio</h1>
          <p>Detected media from pages you visit, including accessible HLS and DASH manifests.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" type="button" onClick={() => void refresh()}>
            <RefreshCw size={15} /> Rescan list
          </button>
        </div>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      <div className="toolbar">
        <div className="search-field">
          <Search />
          <input
            className="input"
            placeholder="Search media title, site or type…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search detected media"
          />
        </div>
        <select
          className="select"
          value={kind}
          onChange={(event) => setKind(event.target.value as 'all' | MediaResource['kind'])}
          aria-label="Filter media type"
        >
          <option value="all">All media</option>
          <option value="video">Video</option>
          <option value="audio">Audio</option>
          <option value="hls">HLS</option>
          <option value="dash">DASH</option>
          <option value="unknown">Unknown</option>
        </select>
        <span className="toolbar-count">{filtered.length} detected</span>
      </div>

      {loading && media.length === 0 ? (
        <div className="panel panel-pad loading-screen">
          <div className="spinner" /> Looking for detected media…
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={Film}
            title="No media detected yet"
            description="Play a video or audio file, or open a page with an accessible HLS or DASH stream. DownFlow records media it can see and never touches DRM-protected streams."
          >
            <span className="chip">Detection runs while Chrome is open</span>
          </EmptyState>
        </div>
      ) : (
        <div className="media-grid">
          {filtered.map((resource) => (
            <MediaCard
              key={resource.id}
              resource={resource}
              notify={notify}
              onRefresh={refresh}
              onStarted={onStarted}
            />
          ))}
        </div>
      )}

      <div className="help-box">
        HLS files are saved by concatenating accessible media segments into a <span className="mono">.ts</span> file
        (or <span className="mono">.mp4</span> for fragmented MP4 playlists). DASH downloads do not merge separate audio
        and video tracks. Encrypted or DRM-protected streams are flagged and skipped.
      </div>
    </>
  );
}
