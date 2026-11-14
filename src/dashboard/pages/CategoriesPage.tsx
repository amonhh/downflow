import { useEffect, useMemo, useState } from 'react';
import { FolderTree, HardDrive, Search } from 'lucide-react';
import type { AppSettings, DownloadRecord, FileCategory } from '../../shared/types';
import { CATEGORY_LABELS } from '../../shared/constants';
import { formatBytes, getFileCategory } from '../../shared/utilities';
import { FileTile, Switch } from '../../ui/components';
import type { ToastKind } from '../../ui/Toast';

const EXAMPLES: Record<FileCategory, string> = {
  documents: 'report.pdf',
  videos: 'movie.mp4',
  audio: 'track.mp3',
  images: 'photo.png',
  archives: 'bundle.zip',
  software: 'installer.exe',
  other: 'file.bin',
};

const DESCRIPTIONS: Record<FileCategory, string> = {
  documents: 'PDF, Word, Excel, text and e-books',
  videos: 'MP4, WebM, MOV, MKV and more',
  audio: 'MP3, WAV, M4A, OGG and more',
  images: 'JPEG, PNG, GIF, WebP and SVG',
  archives: 'ZIP, RAR, 7z, TAR and GZip',
  software: 'EXE, MSI, APK, ISO and packages',
  other: 'Unrecognised or generic files',
};

export function CategoriesPage({
  downloads,
  settings,
  save,
  onFilter,
  notify,
}: {
  downloads: DownloadRecord[];
  settings: AppSettings;
  save: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  onFilter: (category: FileCategory) => void;
  notify: (message: string, kind?: ToastKind) => void;
}): React.JSX.Element {
  const [folders, setFolders] = useState<Record<FileCategory, string>>({ ...settings.categoryFolders });
  const [search, setSearch] = useState('');
  const [savingCategory, setSavingCategory] = useState<FileCategory | null>(null);

  useEffect(() => {
    setFolders({ ...settings.categoryFolders });
  }, [settings.categoryFolders]);

  const stats = useMemo(() => {
    const map = {} as Record<FileCategory, { count: number; bytes: number }>;
    (Object.keys(CATEGORY_LABELS) as FileCategory[]).forEach((category) => {
      map[category] = { count: 0, bytes: 0 };
    });
    for (const record of downloads) {
      const category = record.category ?? getFileCategory(record.filename, record.mime);
      map[category].count += 1;
      map[category].bytes += record.totalBytes || record.downloadedBytes;
    }
    return map;
  }, [downloads]);

  const categories = (Object.keys(CATEGORY_LABELS) as FileCategory[]).filter((category) =>
    search.trim() ? CATEGORY_LABELS[category].toLowerCase().includes(search.trim().toLowerCase()) : true,
  );

  const saveFolder = async (category: FileCategory): Promise<void> => {
    setSavingCategory(category);
    try {
      await save({ categoryFolders: { ...settings.categoryFolders, [category]: folders[category] } });
      notify(`${CATEGORY_LABELS[category]} folder saved.`, 'success');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Could not save the folder.', 'error');
    } finally {
      setSavingCategory(null);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Categories</h1>
          <p>Folder layout, counts and storage for each recognised file category.</p>
        </div>
        <div className="page-actions">
          <span className="chip">
            <FolderTree size={12} /> {settings.defaultFolder}
          </span>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <div className="stat-card">
          <div className="stat-icon"><HardDrive /></div>
          <span className="stat-label">Total tracked size</span>
          <span className="stat-value">{formatBytes(downloads.reduce((sum, record) => sum + (record.totalBytes || record.downloadedBytes), 0))}</span>
          <span className="stat-hint">{downloads.length} stored downloads</span>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><FolderTree /></div>
          <span className="stat-label">Categorised files</span>
          <span className="stat-value">{downloads.filter((record) => record.category !== 'other').length}</span>
          <span className="stat-hint">Based on extension and MIME type</span>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><FolderTree /></div>
          <span className="stat-label">Folder structure</span>
          <span className="stat-value">{settings.categorizeFolders ? 'On' : 'Flat'}</span>
          <span className="stat-hint">Chrome’s Downloads folder is the base</span>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Folder rules</h2>
            <p>Relative folders are created under Chrome’s configured Downloads folder.</p>
          </div>
          <div className="row">
            <span className="small muted">Use category folders</span>
            <Switch
              checked={settings.categorizeFolders}
              label="Save downloads into category folders"
              onChange={(checked) => {
                void save({ categorizeFolders: checked })
                  .then(() => notify(checked ? 'Category folders enabled.' : 'Files will be saved directly in the default folder.', 'success'))
                  .catch((caught: unknown) => notify(caught instanceof Error ? caught.message : 'Could not save settings.', 'error'));
              }}
            />
          </div>
        </div>
        <div className="panel-body">
          <div className="setting-row">
            <div className="setting-copy">
              <div className="setting-title">Default root folder</div>
              <div className="setting-desc">
                DownFlow saves files to <span className="mono">{settings.defaultFolder}</span> inside Chrome’s download
                directory. Chrome does not allow an extension to select an arbitrary operating-system folder.
              </div>
            </div>
            <div className="setting-control">
              <input
                className="input"
                value={settings.defaultFolder}
                readOnly
                aria-label="Default root folder"
              />
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-copy">
              <div className="setting-title">Auto-categorise new downloads</div>
              <div className="setting-desc">Detect file type from the filename and server MIME type when a download is added.</div>
            </div>
            <div className="setting-control">
              <Switch
                checked={settings.autoCategorize}
                label="Auto-categorise new downloads"
                onChange={(checked) => {
                  void save({ autoCategorize: checked })
                    .then(() => notify('Category detection updated.', 'success'))
                    .catch((caught: unknown) => notify(caught instanceof Error ? caught.message : 'Could not save settings.', 'error'));
                }}
              />
            </div>
          </div>
        </div>
      </section>

      <div className="toolbar">
        <div className="search-field">
          <Search />
          <input
            className="input"
            placeholder="Search categories…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search categories"
          />
        </div>
        <span className="toolbar-count">Safe paths: separators and reserved names are sanitised automatically.</span>
      </div>

      <div className="category-grid">
        {categories.map((category) => (
          <article className="category-card" key={category}>
            <div className="category-top">
              <FileTile record={{ filename: EXAMPLES[category], category }} />
              <div>
                <h3>{CATEGORY_LABELS[category]}</h3>
                <p>{DESCRIPTIONS[category]}</p>
              </div>
            </div>
            <div className="category-folder">
              <input
                className="input"
                value={folders[category]}
                onChange={(event) => setFolders((current) => ({ ...current, [category]: event.target.value }))}
                aria-label={`${CATEGORY_LABELS[category]} folder`}
                placeholder={CATEGORY_LABELS[category]}
              />
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={() => void saveFolder(category)}
                disabled={savingCategory === category || folders[category] === settings.categoryFolders[category]}
              >
                Save
              </button>
            </div>
            <div className="category-footer">
              <span>
                <strong>{stats[category].count}</strong> files · {formatBytes(stats[category].bytes)}
              </span>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => onFilter(category)}>
                View
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="help-box">
        Category folders use the same download path as the built-in Downloads API. If a path is invalid, Chrome falls
        back to the default download location rather than writing outside it. Folder names cannot contain
        <span className="mono"> &lt; &gt; : &quot; / \ | ? * </span>.
      </div>
    </>
  );
}
