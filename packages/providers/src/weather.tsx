import { useState } from 'react';
import type { Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import { storageGet, storageSet } from '@panodash/core/storage';
import { Sparkline } from '@panodash/ui/Sparkline';

/**
 * Weather via Open-Meteo — keyless and free, which is why its two origins
 * are the only host permissions Panodash ships with: the widget works on
 * first run with zero setup beyond typing a city. Temperature is recorded
 * to history like any other metric.
 */
interface WeatherConfig {
  location: string;
  unit: 'celsius' | 'fahrenheit';
}

interface WeatherMeta {
  code: number;
  hi: number;
  lo: number;
  wind: number;
  windUnit: string;
  humidity: number;
  place: string;
  [key: string]: unknown;
}

/** WMO weather interpretation codes → label + glyph. */
export function describeWmo(code: number): { label: string; emoji: string } {
  if (code === 0) return { label: 'Clear', emoji: '☀️' };
  if (code === 1) return { label: 'Mostly clear', emoji: '🌤️' };
  if (code === 2) return { label: 'Partly cloudy', emoji: '⛅' };
  if (code === 3) return { label: 'Overcast', emoji: '☁️' };
  if (code === 45 || code === 48) return { label: 'Fog', emoji: '🌫️' };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', emoji: '🌦️' };
  if (code >= 61 && code <= 67) return { label: 'Rain', emoji: '🌧️' };
  if (code >= 71 && code <= 77) return { label: 'Snow', emoji: '🌨️' };
  if (code >= 80 && code <= 82) return { label: 'Showers', emoji: '🌦️' };
  if (code === 85 || code === 86) return { label: 'Snow showers', emoji: '🌨️' };
  if (code === 95) return { label: 'Thunderstorm', emoji: '⛈️' };
  if (code === 96 || code === 99) return { label: 'Thunderstorm, hail', emoji: '⛈️' };
  return { label: 'Weather', emoji: '🌡️' };
}

interface Place {
  lat: number;
  lon: number;
  label: string;
}

async function geocode(name: string): Promise<Place> {
  const key = `geocode:${name.trim().toLowerCase()}`;
  const cached = await storageGet<Place>(key);
  if (cached) return cached;
  const params = new URLSearchParams({ name: name.trim(), count: '1', language: 'en', format: 'json' });
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  if (!res.ok) throw new Error(`Geocoding failed (HTTP ${res.status})`);
  const json = (await res.json()) as {
    results?: { latitude: number; longitude: number; name: string; admin1?: string; country?: string }[];
  };
  const hit = json.results?.[0];
  if (!hit) throw new Error(`Couldn't find “${name.trim()}”`);
  const parts = [hit.name, hit.admin1 ?? hit.country].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  const place: Place = {
    lat: hit.latitude,
    lon: hit.longitude,
    label: [...new Set(parts)].join(', '),
  };
  await storageSet(key, place);
  return place;
}

async function fetchWeather(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as WeatherConfig;
  if (!config.location?.trim()) return { fetchedAt: Date.now() };

  const place = await geocode(config.location);
  const fahrenheit = config.unit === 'fahrenheit';
  const params = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lon),
    current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min',
    forecast_days: '1',
    timezone: 'auto',
  });
  if (fahrenheit) {
    params.set('temperature_unit', 'fahrenheit');
    params.set('wind_speed_unit', 'mph');
  }
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) return { fetchedAt: Date.now(), error: `Open-Meteo HTTP ${res.status}`, errorCode: 'http' };
  const json = (await res.json()) as {
    current: { temperature_2m: number; relative_humidity_2m: number; weather_code: number; wind_speed_10m: number };
    daily: { temperature_2m_max: number[]; temperature_2m_min: number[] };
  };
  const meta: WeatherMeta = {
    code: json.current.weather_code,
    hi: json.daily.temperature_2m_max[0],
    lo: json.daily.temperature_2m_min[0],
    wind: json.current.wind_speed_10m,
    windUnit: fahrenheit ? 'mph' : 'km/h',
    humidity: json.current.relative_humidity_2m,
    place: place.label,
  };
  return {
    fetchedAt: Date.now(),
    value: Math.round(json.current.temperature_2m * 10) / 10,
    meta,
  };
}

function WeatherWidget({ instance, snapshot, samples, updateConfig }: WidgetComponentProps) {
  const config = instance.config as unknown as WeatherConfig;
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  if (!config.location?.trim()) {
    return (
      <div className="weather-setup">
        <p className="feed-empty">Where are you?</p>
        <form
          className="manual-entry"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim() === '' || saving) return;
            setSaving(true);
            void updateConfig({ location: draft.trim() }).finally(() => setSaving(false));
          }}
        >
          <input
            type="text"
            value={draft}
            placeholder="City, e.g. Stockholm"
            aria-label="Your city"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" disabled={draft.trim() === '' || saving}>
            Set
          </button>
        </form>
      </div>
    );
  }

  const meta = snapshot?.meta as WeatherMeta | undefined;
  const cond = meta ? describeWmo(meta.code) : null;

  return (
    <div className="weather-tile">
      <div className="weather-now">
        <span className="weather-temp">
          {snapshot?.value !== undefined ? `${Math.round(snapshot.value)}°` : '—'}
        </span>
        {cond && (
          <span className="weather-emoji" role="img" aria-label={cond.label}>
            {cond.emoji}
          </span>
        )}
      </div>
      <div className="weather-cond">
        {cond?.label ?? 'Loading…'}
        {meta && ` · H ${Math.round(meta.hi)}° L ${Math.round(meta.lo)}°`}
      </div>
      <div className="weather-sub">
        {meta && `${meta.place} · wind ${Math.round(meta.wind)} ${meta.windUnit}`}
      </div>
      <div className="stat-spacer" />
      <Sparkline samples={samples} height={26} />
    </div>
  );
}

export const weatherProvider: WidgetProvider = {
  type: 'weather',
  name: 'Weather',
  description: 'Current conditions via Open-Meteo — no API key needed. Tracks temperature.',
  icon: '⛅',
  kind: 'metric',
  auth: 'none',
  defaultSize: { w: 1, h: 1 },
  configFields: [
    { key: 'location', label: 'Location', type: 'text', required: true, placeholder: 'Stockholm' },
    {
      key: 'unit',
      label: 'Units',
      type: 'select',
      options: [
        { value: 'celsius', label: 'Celsius' },
        { value: 'fahrenheit', label: 'Fahrenheit' },
      ],
    },
  ],
  defaultConfig: { location: '', unit: 'celsius' },
  defaultTitle: () => 'Weather',
  pollMinutes: () => 30,
  // Open-Meteo's origins are granted at install time in the manifest, so the
  // seeded first-run widget works without a permission prompt.
  permissionOrigins: () => [],
  fetchSnapshot: fetchWeather,
  component: WeatherWidget,
};
