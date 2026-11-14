import { useMemo, useState } from 'react';
import { Download, Link2, RefreshCw, Video } from 'lucide-react';
import type { DownloadSource, SiteFormat, SiteProbe, StartDownloadResult } from '../shared/types';
import { defaultSiteFormat } from '../shared/site-formats';
import {
  formatDuration,
  getFileCategory,
  pageDownloadHint,
  validateDownloadUrl,
} from '../shared/utilities';
import { probeSite, startDownload, startSiteDownload } from './api';
import { Modal } from './components';

export function AddDownloadModal({
  initialUrl,
  onClose,
  onStarted,
  source,
}: {
  initialUrl?: string;
  onClose: () => void;
  onStarted: (result: StartDownloadResult) => void;
  source: DownloadSource;
}): React.JSX.Element {
  const [url, setUrl] = useState(initialUrl ?? '');
  const [filename, setFilename] = useState('');
  const [priority, setPriority] = useState(1);
  const [addToQueue, setAddToQueue] = useState(false);
  const [saveAs, setSaveAs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<SiteProbe | null>(null);
  const [selection, setSelection] = useState('');
  const [error, setError] = useState<string | null>(null);

  const category = useMemo(() => {
    if (!filename) return null;
    return getFileCategory(filename);
  }, [filename]);

  const pageHint = useMemo(() => (url.trim() ? pageDownloadHint(url.trim()) : null), [url]);
  const selected = useMemo<SiteFormat | undefined>(
    () => probe?.formats.find((format) => format.id === selection),
    [probe, selection],
  );

  const detectFormats = async (): Promise<SiteProbe | null> => {
    const validation = validateDownloadUrl(url);
    if (!validation.valid || !validation.url) {
      setError(validation.reason ?? 'Enter a valid HTTP or HTTPS URL.');
      return null;
    }
    setProbing(true);
    setError(null);
    try {
      const result = await probeSite(validation.url);
      setProbe(result);
      const preset = defaultSiteFormat(result.formats);
      setSelection(preset?.id ?? '');
      if (result.formats.length === 0) {
        setError(result.warning ?? 'No downloadable formats were found for this page.');
      }
      return result;
    } catch (caught) {
      setProbe(null);
      setSelection('');
      setError(caught instanceof Error ? caught.message : 'DownFlow could not inspect this page.');
      return null;
    } finally {
      setProbing(false);
    }
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const validation = validateDownloadUrl(url);
    if (!validation.valid || !validation.url) {
      setError(validation.reason ?? 'Enter a valid HTTP or HTTPS URL.');
      return;
    }

    if (!probe) {
      if (pageHint) {
        await detectFormats();
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await startDownload({
          url: validation.url,
          filename: filename.trim() || undefined,
          priority,
          addToQueue,
          saveAs,
          source,
        });
        onStarted(result);
        onClose();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'DownFlow could not start this download.');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!selected) {
      setError('Choose a video or audio quality from the list.');
      return;
    }
    if (!selected.downloadable) {
      setError(selected.note ?? 'This quality is not available on this computer.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await startSiteDownload({
        url: probe.url,
        formatId: selected.id,
        formatLabel: selected.label,
        ext: selected.ext,
        merge: selected.needsMerge,
        filename: filename.trim() || undefined,
        pageTitle: probe.title,
        priority,
        addToQueue,
        totalBytes: selected.filesize,
        source,
      });
      onStarted(result);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'DownFlow could not start this video download.');
    } finally {
      setBusy(false);
    }
  };

  const primaryLabel = () => {
    if (busy) return probe ? 'Starting…' : 'Starting…';
    if (probing) return 'Checking page…';
    if (probe) return addToQueue ? 'Add to queue' : 'Download selected quality';
    if (pageHint) return 'Check video formats';
    return addToQueue ? 'Add to queue' : 'Start download';
  };

  return (
    <Modal
      title={probe ? 'Choose video quality' : 'Add a download'}
      subtitle={
        probe
          ? 'Formats come from the optional local yt-dlp helper. Nothing is uploaded to a DownFlow server.'
          : 'Paste a direct file link, or a video page such as YouTube to choose a quality.'
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" type="button" onClick={onClose} disabled={busy || probing}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            type="submit"
            form="add-download-form"
            disabled={busy || probing || probe?.formats.length === 0}
          >
            {busy || probing ? (
              <span className="spinner" style={{ width: 14, height: 14 }} />
            ) : probe ? (
              <Video size={15} />
            ) : (
              <Download size={15} />
            )}
            {primaryLabel()}
          </button>
        </>
      }
    >
      <form id="add-download-form" className="stack" onSubmit={(event) => void submit(event)}>
        <div className="field">
          <label htmlFor="download-url">Download URL or video page</label>
          <div className="input-group">
            <Link2 size={15} className="muted" style={{ alignSelf: 'center', marginLeft: 10, marginRight: -28, zIndex: 1 }} />
            <input
              id="download-url"
              className="input"
              style={{ paddingLeft: 34 }}
              type="url"
              inputMode="url"
              placeholder="https://www.youtube.com/watch?v=… or https://example.com/file.zip"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setProbe(null);
                setSelection('');
                setError(null);
              }}
              autoFocus
              required
            />
          </div>
          {pageHint && !probe ? (
            <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 6 }}>
              <span className="hint" style={{ flex: 1 }}>
                This looks like a video page. DownFlow will ask the local helper for available qualities.
              </span>
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={() => void detectFormats()}
                disabled={probing || busy}
              >
                {probing ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <RefreshCw size={13} />}
                {probing ? 'Checking…' : 'Check formats'}
              </button>
            </div>
          ) : null}
        </div>

        {probe ? (
          <div className="stack" style={{ gap: 10 }}>
            <div className="help-box" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <strong style={{ color: 'var(--text)' }}>{probe.title}</strong>
              <span className="tiny muted">
                {[probe.extractor, probe.uploader, probe.durationSeconds ? formatDuration(probe.durationSeconds) : undefined]
                  .filter(Boolean)
                  .join(' · ') || probe.url}
              </span>
              <span className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                <span className={`chip ${probe.helper.ytDlp.available ? 'success' : 'warning'}`}>
                  yt-dlp {probe.helper.ytDlp.available ? probe.helper.ytDlp.version ?? 'ready' : 'missing'}
                </span>
                <span className={`chip ${probe.helper.ffmpeg.available ? 'success' : 'warning'}`}>
                  FFmpeg {probe.helper.ffmpeg.available ? probe.helper.ffmpeg.version ?? 'ready' : 'missing'}
                </span>
                <span className="chip">{probe.formats.length} formats</span>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => void detectFormats()}
                  disabled={probing || busy}
                  title="Check this page again"
                >
                  <RefreshCw size={12} /> Refresh
                </button>
              </span>
            </div>

            <div className="quality-list" role="radiogroup" aria-label="Video and audio quality">
              {probe.formats.map((format) => (
                <label
                  key={format.id}
                  className={`quality-option ${selection === format.id ? 'selected' : ''} ${format.downloadable ? '' : 'disabled'}`}
                  title={format.note}
                  style={format.downloadable ? undefined : { opacity: 0.55, cursor: 'not-allowed' }}
                >
                  <input
                    type="radio"
                    name="site-quality"
                    value={format.id}
                    checked={selection === format.id}
                    disabled={!format.downloadable || busy}
                    onChange={() => setSelection(format.id)}
                  />
                  <span className="quality-label">
                    {format.label}
                    {format.kind === 'video' ? <span className="tiny muted"> · merge with best audio</span> : null}
                  </span>
                  {format.best ? <span className="chip brand">Best</span> : null}
                  {format.kind === 'audio' ? <span className="chip">Audio only</span> : null}
                </label>
              ))}
            </div>

            {selected?.note ? <div className="hint">{selected.note}</div> : null}
            {probe.warning ? <div className="error-box">{probe.warning}</div> : null}
            <div className="help-box">
              Videos are saved by the optional helper to its output folder
              {probe.helper.outputDir ? (
                <>
                  {' '}
                  (<span className="mono">{probe.helper.outputDir}</span>)
                </>
              ) : null}
              . DownFlow does not bypass DRM, paywalls or logins. Only download media you have permission to save.
            </div>
          </div>
        ) : null}

        <div className="form-grid">
          <div className="field span-2">
            <label htmlFor="download-filename">Filename (optional)</label>
            <input
              id="download-filename"
              className="input"
              placeholder={
                probe
                  ? `Leave blank to use the video title (.${selected?.ext ?? 'mp4'})`
                  : 'Leave blank to use the server filename'
              }
              value={filename}
              onChange={(event) => setFilename(event.target.value)}
            />
            {category ? <span className="hint">Detected category: {category}</span> : null}
          </div>
          <div className="field">
            <label htmlFor="download-priority">Priority</label>
            <select
              id="download-priority"
              className="select"
              value={priority}
              onChange={(event) => setPriority(Number(event.target.value))}
            >
              <option value={0}>Low</option>
              <option value={1}>Normal</option>
              <option value={2}>High</option>
            </select>
          </div>
          <div className="field">
            <span className="field-label">Options</span>
            {!probe ? (
              <label className="row small" style={{ gap: 7 }}>
                <input type="checkbox" checked={saveAs} onChange={(event) => setSaveAs(event.target.checked)} />
                Ask Chrome where to save
              </label>
            ) : null}
            <label className="row small" style={{ gap: 7 }}>
              <input type="checkbox" checked={addToQueue} onChange={(event) => setAddToQueue(event.target.checked)} />
              Add to queue without starting now
            </label>
          </div>
        </div>

        {error ? <div className="error-box" role="alert">{error}</div> : null}

        {!probe ? (
          <div className="help-box">
            DownFlow verifies HTTP Range support, Content-Length and file metadata. If the server cannot provide consistent
            byte ranges, the download automatically uses Chrome’s standard engine. Video pages such as YouTube require the
            optional local helper and yt-dlp; DownFlow never claims acceleration for servers that do not support safe
            segmenting.
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
