import { useCallback, useEffect, useRef, useState } from 'react';
import packageJson from '../../package.json';
import type { DashboardSettings, WidgetInstance } from '@panodash/widget-sdk';
import {
  DEFAULT_SETTINGS,
  getSettings,
  onSettingsChange,
  saveSettings,
  storageRemove,
  snapshotKey,
} from '@panodash/core/storage';
import { deleteWidgetSamples, exportAllSamples, importSamples } from '@panodash/core/history';
import { clearTokens } from '@panodash/core/oauth';
import { refreshWidget, requestOriginPermission } from '@panodash/core/fetcher';
import { applyColors, nextTheme, themeLabel, applyTheme } from '@panodash/core/theme';
import { Dashboard } from '@panodash/ui/Dashboard';
import { WidgetDialog } from '@panodash/ui/WidgetDialog';
import { HistoryModal } from '@panodash/ui/HistoryModal';
import { ShareDialog } from '@panodash/ui/ShareDialog';
import { BridgeDialog } from '@panodash/ui/BridgeDialog';
import { DataSourceDialog } from '@panodash/ui/DataSourceDialog';
import { disconnectBridge } from '@panodash/core/bridge';
import { Menu } from '@panodash/ui/Menu';
import { BrandMark } from '@panodash/ui/BrandMark';
import { ColorDialog } from '@panodash/ui/ColorDialog';

const REPO_URL = 'https://github.com/panodash/panodash';

type DialogState = { mode: 'add' } | { mode: 'edit'; id: string } | null;

export function App() {
  const [settings, setSettings] = useState<DashboardSettings | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const [bridgeOpen, setBridgeOpen] = useState(false);
  const [dataSourcesOpen, setDataSourcesOpen] = useState(false);
  const [colorsOpen, setColorsOpen] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getSettings().then(setSettings);
    return onSettingsChange(setSettings);
  }, []);

  useEffect(() => {
    if (!settings) return;
    applyTheme(settings.theme);
    applyColors(settings.colors);
  }, [settings?.theme, settings?.colors]);

  const persist = useCallback((next: DashboardSettings) => {
    setSettings(next);
    void saveSettings(next);
  }, []);

  if (!settings) return null;

  const themeIcon = settings.theme === 'light' ? '☀' : settings.theme === 'dark' ? '☾' : '◐';

  async function handleSaveWidget(instance: WidgetInstance) {
    // Permission request first — it must stay inside the click gesture.
    await requestOriginPermission(instance);
    const current = settings!;
    const exists = current.widgets.some((w) => w.id === instance.id);
    const widgets = exists
      ? current.widgets.map((w) => (w.id === instance.id ? instance : w))
      : [...current.widgets, instance];
    persist({ ...current, widgets });
    void refreshWidget(instance);
  }

  function handleRemove(id: string) {
    const widget = settings!.widgets.find((w) => w.id === id);
    const name = widget?.title ?? 'this widget';
    if (!window.confirm(`Remove ${name}? Its recorded history will be deleted too.`)) return;
    persist({ ...settings!, widgets: settings!.widgets.filter((w) => w.id !== id) });
    void storageRemove(snapshotKey(id));
    void clearTokens(id);
    void disconnectBridge(id);
    void deleteWidgetSamples(id);
  }

  async function handleUpdateInstance(updated: WidgetInstance) {
    const current = settings!;
    const next = {
      ...current,
      widgets: current.widgets.map((w) => (w.id === updated.id ? updated : w)),
    };
    setSettings(next);
    await saveSettings(next);
  }

  function handleReorder(fromId: string, toId: string) {
    const widgets = [...settings!.widgets];
    const from = widgets.findIndex((w) => w.id === fromId);
    const to = widgets.findIndex((w) => w.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    const [moved] = widgets.splice(from, 1);
    widgets.splice(to, 0, moved);
    setSettings({ ...settings!, widgets });
  }

  function handleResize(id: string, w: number, h: number) {
    persist({
      ...settings!,
      widgets: settings!.widgets.map((widget) =>
        widget.id === id ? { ...widget, size: { w, h } } : widget,
      ),
    });
  }

  // A credential change makes cached snapshots stale — a widget that failed
  // for want of a token should recover without waiting for the next poll.
  function handleConnectionsChanged(widgetIds: string[]) {
    for (const id of new Set(widgetIds)) {
      const widget = settings!.widgets.find((w) => w.id === id);
      if (widget) void refreshWidget(widget);
    }
  }

  async function handleExport() {
    const samples = await exportAllSamples();
    const payload = { app: 'panodash', version: 1, exportedAt: new Date().toISOString(), settings, samples };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `panodash-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(file: File) {
    try {
      const payload = JSON.parse(await file.text()) as {
        app?: string;
        settings?: DashboardSettings;
        samples?: { widgetId: string; t: number; value: number }[];
      };
      // 'panorama' was the pre-rebrand marker — old backups stay importable.
      if ((payload.app !== 'panodash' && payload.app !== 'panorama') || !payload.settings) {
        window.alert('That file does not look like a Panodash backup.');
        return;
      }
      if (!window.confirm('Importing replaces your current dashboard layout and adds the backup’s history. Continue?')) {
        return;
      }
      persist({
        ...DEFAULT_SETTINGS,
        ...payload.settings,
        colors: { ...DEFAULT_SETTINGS.colors, ...payload.settings.colors },
      });
      if (payload.samples?.length) await importSamples(payload.samples);
    } catch {
      window.alert('Could not read that backup file.');
    }
  }

  const editing =
    dialog?.mode === 'edit' ? settings.widgets.find((w) => w.id === dialog.id) : undefined;

  return (
    <div className="app">
      <header className="app-header">
        <div className="wordmark-lockup">
          <BrandMark />
          <div className="wordmark">
            <span>pano<span className="wordmark-accent">dash_</span></span>
            <span className="wordmark-sub">your whole signal, locally</span>
          </div>
        </div>
        <div className="header-actions">
          <button type="button" className="button-primary" onClick={() => setDialog({ mode: 'add' })}>
            + Add widget
          </button>
          <button
            type="button"
            className="icon-button theme-toggle"
            title={themeLabel(settings.theme)}
            aria-label={`${themeLabel(settings.theme)} — click to switch`}
            onClick={() => persist({ ...settings, theme: nextTheme(settings.theme) })}
          >
            {themeIcon}
          </button>
          <Menu
            ariaLabel="Dashboard options"
            trigger={<span aria-hidden="true">⋯</span>}
            items={[
              { heading: 'Data sources' },
              { label: 'Connections…', onSelect: () => setDataSourcesOpen(true) },
              { label: 'Auth bridge…', onSelect: () => setBridgeOpen(true), checked: !!settings.bridgeUrl },
              { heading: 'Dashboard' },
              { label: 'Export data…', onSelect: () => void handleExport() },
              { label: 'Import backup…', onSelect: () => importRef.current?.click() },
              { label: 'Color palette…', onSelect: () => setColorsOpen(true) },
              'divider',
              { label: 'View on GitHub', onSelect: () => window.open(REPO_URL, '_blank') },
            ]}
          />
        </div>
      </header>

      {settings.widgets.length === 0 ? (
        <div className="empty-state">
          <svg className="empty-signal" viewBox="0 0 560 130" aria-hidden="true">
            <path className="empty-horizon" d="M-20 118 H580" />
            <path
              className="empty-signal-path"
              pathLength="1"
              d="M-20 104 C50 96 84 112 128 90 S208 102 252 66 S336 80 388 40 S492 54 545 22"
            />
            <circle className="empty-now-ring" cx="545" cy="22" r="9" />
            <circle className="empty-now" cx="545" cy="22" r="5" />
          </svg>
          <h1>See your whole signal.</h1>
          <p>
            Every metric you care about — one private new tab. Connect an API, type a number,
            keep the history. It all stays on this machine.
          </p>
          <button type="button" className="button-primary" onClick={() => setDialog({ mode: 'add' })}>
            + Add your first widget
          </button>
        </div>
      ) : (
        <Dashboard
          widgets={settings.widgets}
          onReorder={handleReorder}
          onCommitOrder={() => void saveSettings(settings)}
          onEdit={(id) => setDialog({ mode: 'edit', id })}
          onRemove={handleRemove}
          onResize={handleResize}
          onShowHistory={setHistoryId}
          onShare={setShareId}
          onUpdateInstance={handleUpdateInstance}
        />
      )}

      <input
        ref={importRef}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleImportFile(file);
          e.target.value = '';
        }}
      />

      {dialog && (
        <WidgetDialog
          existing={editing}
          widgets={settings.widgets}
          onSave={handleSaveWidget}
          onClose={() => setDialog(null)}
        />
      )}
      {historyId && settings.widgets.some((w) => w.id === historyId) && (
        <HistoryModal
          instance={settings.widgets.find((w) => w.id === historyId)!}
          onClose={() => setHistoryId(null)}
        />
      )}
      {shareId && settings.widgets.some((w) => w.id === shareId) && (
        <ShareDialog
          instance={settings.widgets.find((w) => w.id === shareId)!}
          onClose={() => setShareId(null)}
        />
      )}
      {dataSourcesOpen && (
        <DataSourceDialog
          widgets={settings.widgets}
          bridgeUrl={settings.bridgeUrl}
          onOpenBridge={() => {
            setDataSourcesOpen(false);
            setBridgeOpen(true);
          }}
          onConnectionsChanged={handleConnectionsChanged}
          onClose={() => setDataSourcesOpen(false)}
        />
      )}
      {bridgeOpen && (
        <BridgeDialog
          current={settings.bridgeUrl}
          onSave={(bridgeUrl) => persist({ ...settings, bridgeUrl })}
          onClose={() => setBridgeOpen(false)}
        />
      )}
      {colorsOpen && (
        <ColorDialog
          current={settings.colors}
          onSave={(colors) => persist({ ...settings, colors })}
          onClose={() => setColorsOpen(false)}
        />
      )}
      <div className="app-version" aria-label={`Panodash version ${packageJson.version}`}>
        v{packageJson.version}
      </div>
    </div>
  );
}
