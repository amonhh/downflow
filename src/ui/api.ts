import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AppSettings,
  DownloadsListResponse,
  ExtensionInfo,
  MediaResource,
  Schedule,
  ScheduleInput,
  SiteDownloadInput,
  SiteHelperStatus,
  SiteProbe,
  StartDownloadInput,
  StartDownloadResult,
  StatsSummary,
} from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/constants';
import { sendRequest } from '../shared/messaging';
import { cleanErrorMessage } from '../shared/utilities';

export const EMPTY_DOWNLOADS: DownloadsListResponse = {
  downloads: [],
  queuePaused: false,
  activeSpeedBps: 0,
};

export function errorMessage(error: unknown): string {
  return cleanErrorMessage(error);
}

export function useDownloads(pollMs = 1200): {
  data: DownloadsListResponse;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<DownloadsListResponse>(EMPTY_DOWNLOADS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await sendRequest<DownloadsListResponse>({ type: 'downloads:list' });
      if (!mounted.current) return;
      setData(next);
      setError(null);
    } catch (caught) {
      if (!mounted.current) return;
      setError(errorMessage(caught));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [pollMs, refresh]);

  return { data, loading, error, refresh };
}

export function useSettings(): {
  settings: AppSettings;
  loading: boolean;
  error: string | null;
  save: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  refresh: () => Promise<void>;
} {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await sendRequest<AppSettings>({ type: 'settings:get' });
      setSettings(next);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async (patch: Partial<AppSettings>) => {
    const next = await sendRequest<AppSettings>({ type: 'settings:update', patch });
    setSettings(next);
    return next;
  }, []);

  return { settings, loading, error, save, refresh };
}

export function useStats(pollMs = 5000): {
  stats: StatsSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await sendRequest<StatsSummary>({ type: 'stats:get' });
      setStats(next);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [pollMs, refresh]);

  return { stats, loading, error, refresh };
}

export function useInfo(pollMs = 20_000): {
  info: ExtensionInfo | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [info, setInfo] = useState<ExtensionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await sendRequest<ExtensionInfo>({ type: 'system:get-info' });
      setInfo(next);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [pollMs, refresh]);

  return { info, loading, error, refresh };
}

export function useMedia(): {
  media: MediaResource[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  probe: (id: string) => Promise<void>;
} {
  const [media, setMedia] = useState<MediaResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await sendRequest<MediaResource[]>({ type: 'media:list' });
      setMedia(next);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const remove = useCallback(
    async (id: string) => {
      await sendRequest({ type: 'media:remove', id });
      setMedia((current) => current.filter((resource) => resource.id !== id));
    },
    [],
  );

  const probe = useCallback(async (id: string) => {
    const updated = await sendRequest<MediaResource>({ type: 'media:probe', id });
    setMedia((current) => current.map((resource) => (resource.id === id ? updated : resource)));
  }, []);

  return { media, loading, error, refresh, remove, probe };
}

export function useSchedules(): {
  schedules: Schedule[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (input: ScheduleInput) => Promise<Schedule>;
  update: (id: string, patch: Partial<ScheduleInput>) => Promise<Schedule>;
  remove: (id: string) => Promise<void>;
  runNow: (id: string) => Promise<void>;
} {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await sendRequest<Schedule[]>({ type: 'schedules:list' });
      setSchedules(next);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const create = useCallback(
    async (input: ScheduleInput) => {
      const schedule = await sendRequest<Schedule>({ type: 'schedules:create', payload: input });
      await refresh();
      return schedule;
    },
    [refresh],
  );

  const update = useCallback(
    async (id: string, patch: Partial<ScheduleInput>) => {
      const schedule = await sendRequest<Schedule>({ type: 'schedules:update', id, payload: patch });
      await refresh();
      return schedule;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await sendRequest({ type: 'schedules:delete', id });
      await refresh();
    },
    [refresh],
  );

  const runNow = useCallback(
    async (id: string) => {
      await sendRequest({ type: 'schedules:run', id });
      await refresh();
    },
    [refresh],
  );

  return { schedules, loading, error, refresh, create, update, remove, runNow };
}

export async function startDownload(input: StartDownloadInput): Promise<StartDownloadResult> {
  return sendRequest<StartDownloadResult>({ type: 'downloads:start', payload: input });
}

export async function probeSite(url: string): Promise<SiteProbe> {
  return sendRequest<SiteProbe>({ type: 'site:probe', url });
}

export async function startSiteDownload(input: SiteDownloadInput): Promise<StartDownloadResult> {
  return sendRequest<StartDownloadResult>({ type: 'site:start', payload: input });
}

export async function getSiteHelperStatus(force = false): Promise<SiteHelperStatus> {
  return sendRequest<SiteHelperStatus>({ type: 'site:status', force });
}

export function useSiteHelperStatus(pollMs = 30_000): {
  status: SiteHelperStatus | null;
  loading: boolean;
  refresh: (force?: boolean) => Promise<SiteHelperStatus>;
} {
  const [status, setStatus] = useState<SiteHelperStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (force = false) => {
    try {
      const next = await getSiteHelperStatus(force);
      setStatus(next);
      return next;
    } catch (caught) {
      const fallback: SiteHelperStatus = {
        available: false,
        ytDlp: { available: false },
        ffmpeg: { available: false },
        error: caught instanceof Error ? caught.message : 'Could not reach the DownFlow background service.',
      };
      setStatus(fallback);
      return fallback;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [pollMs, refresh]);

  return { status, loading, refresh };
}

export function useHashRoute(defaultRoute = 'overview'): {
  route: string;
  navigate: (route: string) => void;
} {
  const read = (): string => {
    const hash = window.location.hash.replace(/^#\/?/, '');
    return hash || defaultRoute;
  };
  const [route, setRoute] = useState(read);

  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
    // read is intentionally recreated per route change; defaultRoute is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultRoute]);

  const navigate = useCallback((next: string) => {
    window.location.hash = next;
    setRoute(next);
  }, []);

  return { route, navigate };
}
