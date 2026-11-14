import { useState } from 'react';
import {
  AlarmClock,
  CalendarClock,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { Schedule, ScheduleInput } from '../../shared/types';
import { formatCountdown } from '../../shared/scheduler';
import { formatDateTime } from '../../shared/utilities';
import { useSchedules } from '../../ui/api';
import { EmptyState, Switch } from '../../ui/components';
import type { ToastKind } from '../../ui/Toast';

function toLocalInput(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultRunAt(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return toLocalInput(date.getTime());
}

const EMPTY_FORM = {
  name: '',
  action: 'start-queue' as ScheduleInput['action'],
  mode: 'daily' as ScheduleInput['mode'],
  runAt: defaultRunAt(),
  time: '09:00',
  maxDownloads: 3,
  enabled: true,
};

export function SchedulerPage({
  notify,
  onChanged,
}: {
  notify: (message: string, kind?: ToastKind) => void;
  onChanged: () => Promise<void>;
}): React.JSX.Element {
  const { schedules, loading, error, create, update, remove, runNow } = useSchedules();
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const openCreate = (): void => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, runAt: defaultRunAt() });
    setShowForm(true);
  };

  const openEdit = (schedule: Schedule): void => {
    setEditing(schedule);
    setForm({
      name: schedule.name,
      action: schedule.action,
      mode: schedule.mode,
      runAt: toLocalInput(schedule.runAt ?? Date.now() + 86_400_000),
      time: schedule.time ?? '09:00',
      maxDownloads: schedule.maxDownloads,
      enabled: schedule.enabled,
    });
    setShowForm(true);
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      const input: ScheduleInput = {
        name: form.name.trim(),
        action: form.action,
        mode: form.mode,
        maxDownloads: form.maxDownloads,
        enabled: form.enabled,
        ...(form.mode === 'once' ? { runAt: new Date(form.runAt).getTime() } : { time: form.time }),
      };
      if (editing) {
        await update(editing.id, input);
        notify('Schedule updated.', 'success');
      } else {
        await create(input);
        notify('Schedule created. Chrome must stay running for it to fire.', 'success');
      }
      setShowForm(false);
      setEditing(null);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Could not save the schedule.', 'error');
    }
  };

  const toggle = async (schedule: Schedule, enabled: boolean): Promise<void> => {
    setBusy(schedule.id);
    try {
      await update(schedule.id, { enabled });
      notify(enabled ? 'Schedule enabled.' : 'Schedule disabled.', 'success');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Could not change the schedule.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const run = async (schedule: Schedule): Promise<void> => {
    setBusy(schedule.id);
    try {
      await runNow(schedule.id);
      await onChanged();
      notify(
        schedule.action === 'start-queue'
          ? `Schedule “${schedule.name}” started the queue.`
          : `Schedule “${schedule.name}” paused active downloads.`,
        'success',
      );
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Could not run the schedule.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const drop = async (schedule: Schedule): Promise<void> => {
    if (!window.confirm(`Delete the schedule “${schedule.name}”?`)) return;
    setBusy(schedule.id);
    try {
      await remove(schedule.id);
      notify('Schedule deleted.', 'success');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Could not delete the schedule.', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Scheduler</h1>
          <p>Start or pause the queue automatically with Chrome alarms. Chrome must be running.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" type="button" onClick={openCreate}>
            <Plus size={15} /> New schedule
          </button>
        </div>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      {showForm ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>{editing ? 'Edit schedule' : 'New schedule'}</h2>
              <p>Times use this computer’s local timezone.</p>
            </div>
            <button className="icon-btn" type="button" onClick={() => setShowForm(false)} aria-label="Close form">
              <X size={16} />
            </button>
          </div>
          <div className="panel-body">
            <form className="schedule-form" onSubmit={(event) => void submit(event)}>
              <div className="field span-2">
                <label htmlFor="schedule-name">Name</label>
                <input
                  id="schedule-name"
                  className="input"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="Nightly downloads"
                  required
                  maxLength={80}
                />
              </div>

              <div className="field">
                <label htmlFor="schedule-action">Action</label>
                <select
                  id="schedule-action"
                  className="select"
                  value={form.action}
                  onChange={(event) => setForm({ ...form, action: event.target.value as ScheduleInput['action'] })}
                >
                  <option value="start-queue">Start queue</option>
                  <option value="pause-all">Pause all downloads</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="schedule-mode">Repeat</label>
                <select
                  id="schedule-mode"
                  className="select"
                  value={form.mode}
                  onChange={(event) => setForm({ ...form, mode: event.target.value as ScheduleInput['mode'] })}
                >
                  <option value="daily">Every day</option>
                  <option value="once">One time</option>
                </select>
              </div>

              {form.mode === 'daily' ? (
                <div className="field">
                  <label htmlFor="schedule-time">Time (24-hour)</label>
                  <input
                    id="schedule-time"
                    className="input"
                    type="time"
                    value={form.time}
                    onChange={(event) => setForm({ ...form, time: event.target.value })}
                    required
                  />
                </div>
              ) : (
                <div className="field">
                  <label htmlFor="schedule-run-at">Date &amp; time</label>
                  <input
                    id="schedule-run-at"
                    className="input"
                    type="datetime-local"
                    value={form.runAt}
                    onChange={(event) => setForm({ ...form, runAt: event.target.value })}
                    required
                  />
                </div>
              )}

              <div className="field">
                <label htmlFor="schedule-max">Start up to</label>
                <input
                  id="schedule-max"
                  className="input number"
                  type="number"
                  min={1}
                  max={20}
                  value={form.maxDownloads}
                  disabled={form.action === 'pause-all'}
                  onChange={(event) => setForm({ ...form, maxDownloads: Math.max(1, Number(event.target.value) || 1) })}
                />
                <span className="hint">
                  {form.action === 'start-queue' ? 'downloads at a time when the queue starts' : 'Not used when pausing'}
                </span>
              </div>

              <div className="field span-2">
                <label className="row" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
                  />
                  Enable this schedule immediately
                </label>
              </div>

              <div className="form-actions">
                <button className="btn btn-ghost" type="button" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
                <button className="btn btn-primary" type="submit">
                  {editing ? 'Save changes' : 'Create schedule'}
                </button>
              </div>
            </form>
          </div>
        </section>
      ) : null}

      {loading && schedules.length === 0 ? (
        <div className="panel panel-pad loading-screen">
          <div className="spinner" /> Loading schedules…
        </div>
      ) : schedules.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={CalendarClock}
            title="No schedules yet"
            description="Create a one-off or daily job to start your queue or pause active downloads. Chrome alarms only fire while Chrome is running."
          >
            <button className="btn btn-primary" type="button" onClick={openCreate}>
              <Plus size={15} /> Create a schedule
            </button>
          </EmptyState>
        </div>
      ) : (
        <div className="schedule-list">
          {schedules
            .slice()
            .sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity))
            .map((schedule) => (
              <article className="schedule-card" key={schedule.id}>
                <div className="schedule-icon">
                  {schedule.action === 'start-queue' ? <AlarmClock /> : <CalendarClock />}
                </div>
                <div className="schedule-copy">
                  <h3>{schedule.name}</h3>
                  <p>
                    {schedule.action === 'start-queue' ? `Start up to ${schedule.maxDownloads} download(s)` : 'Pause all active downloads'}
                    {' · '}
                    {schedule.mode === 'daily' ? `Every day at ${schedule.time}` : 'One time'}
                    {' · '}
                    {schedule.enabled ? formatCountdown(schedule.nextRunAt) : 'Disabled'}
                  </p>
                  <p className="tiny">
                    {schedule.enabled
                      ? `Next run ${formatDateTime(schedule.nextRunAt)}`
                      : schedule.lastRunAt
                        ? `Last ran ${formatDateTime(schedule.lastRunAt)}`
                        : 'Saved but currently disabled'}
                  </p>
                </div>
                <div className="schedule-actions">
                  <Switch
                    checked={schedule.enabled}
                    label={`Enable ${schedule.name}`}
                    disabled={busy === schedule.id}
                    onChange={(checked) => void toggle(schedule, checked)}
                  />
                  <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    disabled={busy === schedule.id}
                    onClick={() => void run(schedule)}
                  >
                    <Play size={14} /> Run now
                  </button>
                  <button
                    className="icon-btn"
                    type="button"
                    title="Edit schedule"
                    aria-label="Edit schedule"
                    onClick={() => openEdit(schedule)}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="icon-btn danger"
                    type="button"
                    title="Delete schedule"
                    aria-label="Delete schedule"
                    disabled={busy === schedule.id}
                    onClick={() => void drop(schedule)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            ))}
        </div>
      )}

      <div className="warning-box">
        Chrome alarms are best-effort. DownFlow cannot run a schedule while Chrome is closed, suspended by the operating
        system, or offline. A missed one-off schedule is marked disabled on the next browser start.
      </div>
    </>
  );
}
