/**
 * Background service worker: keeps the time series alive even when no new
 * tab is open. A chrome.alarms tick checks which widgets are due (per their
 * own poll cadence) and refreshes them; a daily alarm prunes old samples.
 */
import { registerBuiltins } from '@panodash/providers';
import { getProvider } from '@panodash/widget-sdk/registry';
import { getSettings, getSnapshot } from '@panodash/core/storage';
import { refreshWidget } from '@panodash/core/fetcher';
import { pruneSamples } from '@panodash/core/history';

registerBuiltins();

const POLL_ALARM = 'panodash-poll';
const PRUNE_ALARM = 'panodash-prune';
const TICK_MINUTES = 5;

function ensureAlarms(): void {
  // clearAll drops any alarms left from earlier versions (pre-rebrand
  // names included) — we own every alarm in this worker.
  void chrome.alarms.clearAll().then(() => {
    chrome.alarms.create(POLL_ALARM, { periodInMinutes: TICK_MINUTES });
    chrome.alarms.create(PRUNE_ALARM, { periodInMinutes: 24 * 60 });
  });
}

chrome.runtime.onInstalled.addListener(ensureAlarms);
chrome.runtime.onStartup.addListener(ensureAlarms);

async function pollDueWidgets(): Promise<void> {
  const settings = await getSettings();
  await Promise.allSettled(
    settings.widgets.map(async (instance) => {
      const provider = getProvider(instance.type);
      if (!provider?.fetchSnapshot) return;
      const pollMs = (provider.pollMinutes?.(instance.config) ?? 15) * 60 * 1000;
      const prev = await getSnapshot(instance.id);
      // 30s slack so a poll due "in a moment" doesn't slip a whole tick.
      if (prev && Date.now() - prev.fetchedAt < pollMs - 30_000) return;
      await refreshWidget(instance);
    }),
  );
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) void pollDueWidgets();
  else if (alarm.name === PRUNE_ALARM) void pruneSamples();
});
