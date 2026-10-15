import { useCallback, useEffect, useRef, useState } from 'react';
import type { Sample, Snapshot, WidgetInstance } from '@panodash/widget-sdk';
import { getProvider } from '@panodash/widget-sdk/registry';
import { addSample, addSamples, getSamples } from '@panodash/core/history';
import { parseCsvSamples } from '@panodash/core/csv';
import { getSnapshot, setSnapshot, snapshotKey, storageSubscribe } from '@panodash/core/storage';
import { refreshIfStale, refreshWidget, requestOriginPermission } from '@panodash/core/fetcher';
import { Menu, type MenuItem } from './Menu';
import { SIZE_PRESETS } from './WidgetDialog';

const SPARKLINE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function useWidgetData(instance: WidgetInstance) {
  const [snapshot, setSnap] = useState<Snapshot | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);

  const loadSamples = useCallback(async () => {
    let recent = await getSamples(instance.id, Date.now() - SPARKLINE_WINDOW_MS);
    if (recent.length === 0) recent = await getSamples(instance.id);
    setSamples(recent);
  }, [instance.id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cached = await getSnapshot(instance.id);
      if (!cancelled && cached) setSnap(cached);
      await loadSamples();
      const fresh = await refreshIfStale(instance);
      if (!cancelled && fresh) setSnap(fresh);
    })();
    const unsubscribe = storageSubscribe((key, value) => {
      if (key === snapshotKey(instance.id) && value) {
        setSnap(value as Snapshot);
        void loadSamples();
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.id, JSON.stringify(instance.config), loadSamples]);

  const refresh = useCallback(() => {
    void refreshWidget(instance).then((snap) => {
      if (snap) setSnap(snap);
      void loadSamples();
    });
  }, [instance, loadSamples]);

  const recordValue = useCallback(
    async (value: number) => {
      const t = Date.now();
      await addSample(instance.id, value, t);
      await setSnapshot(instance.id, { fetchedAt: t, value });
      await loadSamples();
      setSnap({ fetchedAt: t, value });
    },
    [instance.id, loadSamples],
  );

  return { snapshot, samples, refresh, recordValue, setSnap, loadSamples };
}

export function WidgetShell({
  instance,
  onEdit,
  onRemove,
  onResize,
  onShowHistory,
  onShare,
  onUpdateInstance,
  dragHandlers,
}: {
  instance: WidgetInstance;
  onEdit: () => void;
  onRemove: () => void;
  onResize: (w: number, h: number) => void;
  onShowHistory: () => void;
  onShare: () => void;
  onUpdateInstance: (updated: WidgetInstance) => Promise<void> | void;
  dragHandlers: {
    onDragStart: (e: React.DragEvent) => void;
    onDragEnter: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragEnd: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    isDragging: boolean;
  };
}) {
  const provider = getProvider(instance.type);
  const { snapshot, samples, refresh, recordValue, setSnap, loadSamples } = useWidgetData(instance);
  const [grabbable, setGrabbable] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);

  async function importCsvFile(file: File) {
    const rows = parseCsvSamples(await file.text());
    if (rows.length === 0) {
      window.alert('No usable rows found. Expected CSV columns: time, value.');
      return;
    }
    await addSamples(instance.id, rows);
    await loadSamples();
    window.alert(`Imported ${rows.length} data point${rows.length === 1 ? '' : 's'}.`);
  }

  const updateConfig = useCallback(
    async (patch: Record<string, unknown>) => {
      const updated: WidgetInstance = {
        ...instance,
        config: { ...instance.config, ...patch },
      };
      await onUpdateInstance(updated);
      // The cached snapshot may still be "fresh", so force a refetch with
      // the new config rather than waiting for staleness.
      const snap = await refreshWidget(updated);
      if (snap) setSnap(snap);
      await loadSamples();
    },
    [instance, onUpdateInstance, setSnap, loadSamples],
  );

  if (!provider) {
    return (
      <div className="widget-card widget-unknown">
        <div className="widget-header">
          <span className="widget-title">Unknown widget “{instance.type}”</span>
          <button type="button" className="icon-button" onClick={onRemove} aria-label="Remove widget">
            ✕
          </button>
        </div>
        <p className="feed-empty">This widget type isn't registered in this build.</p>
      </div>
    );
  }

  const title = instance.title ?? provider.defaultTitle(instance.config);
  const hasHistory = provider.kind === 'metric' || samples.length > 0;
  const Body = provider.component;

  const menuItems: (MenuItem | 'divider')[] = [
    ...(provider.fetchSnapshot ? [{ label: 'Refresh now', onSelect: refresh }] : []),
    ...(hasHistory ? [{ label: 'View history', onSelect: onShowHistory }] : []),
    { label: 'Edit…', onSelect: onEdit },
    { label: 'Share…', onSelect: onShare },
    ...(provider.kind === 'metric'
      ? [{ label: 'Import CSV…', onSelect: () => csvInputRef.current?.click() }]
      : []),
    'divider' as const,
    ...SIZE_PRESETS.map((p) => ({
      label: p.label,
      checked: p.size.w === instance.size.w && p.size.h === instance.size.h,
      onSelect: () => onResize(p.size.w, p.size.h),
    })),
    'divider' as const,
    { label: 'Remove', onSelect: onRemove, danger: true },
  ];

  return (
    <div
      className={`widget-card w-${instance.size.w} h-${instance.size.h}${dragHandlers.isDragging ? ' dragging' : ''}`}
      draggable={grabbable}
      onDragStart={dragHandlers.onDragStart}
      onDragEnter={dragHandlers.onDragEnter}
      onDragOver={dragHandlers.onDragOver}
      onDragEnd={(e) => {
        setGrabbable(false);
        dragHandlers.onDragEnd(e);
      }}
      onDrop={dragHandlers.onDrop}
    >
      <input
        ref={csvInputRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importCsvFile(file);
          e.target.value = '';
        }}
      />
      <div className="widget-header">
        <button
          type="button"
          className="drag-grip"
          aria-label={`Move ${title}`}
          title="Drag to rearrange"
          onPointerDown={() => setGrabbable(true)}
          onPointerUp={() => setGrabbable(false)}
        >
          ⠿
        </button>
        <span className="widget-title" title={title}>
          {title}
        </span>
        <Menu trigger={<span aria-hidden="true">⋯</span>} ariaLabel={`${title} options`} items={menuItems} />
      </div>

      {snapshot?.error && snapshot.errorCode !== 'auth' && (
        <div className="widget-error" role="status">
          <span>{snapshot.error}</span>
          {snapshot.errorCode === 'permission' && (
            <button
              type="button"
              className="button-small"
              onClick={() => {
                void requestOriginPermission(instance).then((granted) => {
                  if (granted) refresh();
                });
              }}
            >
              Grant access
            </button>
          )}
          {snapshot.errorCode === 'activation' &&
            typeof snapshot.meta?.activationUrl === 'string' && (
              <a
                className="button-small"
                href={snapshot.meta.activationUrl}
                target="_blank"
                rel="noreferrer"
              >
                Activate bridge →
              </a>
            )}
        </div>
      )}

      <div className="widget-body">
        <Body
          instance={instance}
          snapshot={snapshot}
          samples={samples}
          refresh={refresh}
          recordValue={recordValue}
          updateConfig={updateConfig}
        />
      </div>
    </div>
  );
}
