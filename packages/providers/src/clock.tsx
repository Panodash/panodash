import { useEffect, useState } from 'react';
import type { WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';

interface ClockConfig {
  name: string;
  hour12: 'auto' | '12' | '24';
}

function greeting(hour: number): string {
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function ClockWidget({ instance }: WidgetComponentProps) {
  const config = instance.config as unknown as ClockConfig;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const hour12 =
    config.hour12 === 'auto' ? undefined : config.hour12 === '12';
  const time = now.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12,
  });
  const date = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const who = config.name?.trim();

  return (
    <div className="clock-widget">
      <div className="clock-time">{time}</div>
      <div className="clock-sub">
        {greeting(now.getHours())}
        {who ? `, ${who}` : ''} · {date}
      </div>
    </div>
  );
}

export const clockProvider: WidgetProvider = {
  type: 'clock',
  name: 'Clock & greeting',
  description: 'Time, date, and a greeting to start the tab.',
  icon: '🕰️',
  kind: 'utility',
  auth: 'none',
  defaultSize: { w: 2, h: 1 },
  configFields: [
    { key: 'name', label: 'Your name', type: 'text', placeholder: 'optional' },
    {
      key: 'hour12',
      label: 'Clock format',
      type: 'select',
      options: [
        { value: 'auto', label: 'System default' },
        { value: '12', label: '12-hour' },
        { value: '24', label: '24-hour' },
      ],
    },
  ],
  defaultConfig: { name: '', hour12: 'auto' },
  defaultTitle: () => 'Clock',
  component: ClockWidget,
};
