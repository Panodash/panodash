import { beforeAll, describe, expect, it } from 'vitest';
import { registerBuiltins } from '@panodash/providers';
import { sanitizeConfig, snippetToInstance, widgetToSnippet } from '@panodash/core/share';
import { getProvider } from '@panodash/widget-sdk/registry';
import type { WidgetInstance } from '@panodash/widget-sdk';

beforeAll(() => {
  registerBuiltins();
});

function restWidget(): WidgetInstance {
  return {
    id: 'w-1',
    type: 'rest-api',
    title: 'GitHub stars',
    size: { w: 2, h: 1 },
    goal: { value: 2000, direction: 'at-least' },
    config: {
      label: 'GitHub stars',
      url: 'https://api.github.com/repos/x/y',
      valuePath: 'stargazers_count',
      method: 'GET',
      headers: 'Authorization: Bearer SECRET',
      body: '',
      unit: '',
      decimals: 0,
      direction: 'up-good',
      pollMinutes: 60,
    },
  };
}

describe('widgetToSnippet', () => {
  it('exports type, title, size, goal, and declared config', () => {
    const snippet = widgetToSnippet(restWidget());
    expect(snippet.app).toBe('panodash');
    expect(snippet.kind).toBe('widget');
    expect(snippet.widget.type).toBe('rest-api');
    expect(snippet.widget.title).toBe('GitHub stars');
    expect(snippet.widget.size).toEqual({ w: 2, h: 1 });
    expect(snippet.widget.goal).toEqual({ value: 2000, direction: 'at-least' });
    expect(snippet.widget.config.url).toBe('https://api.github.com/repos/x/y');
  });

  it('NEVER exports sensitive free-text fields (REST headers with a bearer token)', () => {
    const snippet = widgetToSnippet(restWidget());
    expect(JSON.stringify(snippet)).not.toContain('SECRET');
    expect(snippet.widget.config.headers).toBe(''); // provider default
  });

  it('NEVER exports password fields (Linear API key)', () => {
    const snippet = widgetToSnippet({
      id: 'w-2',
      type: 'linear-tasks',
      size: { w: 2, h: 2 },
      config: { apiKey: 'lin_api_SUPERSECRET', maxItems: 6, pollMinutes: 15 },
    });
    expect(JSON.stringify(snippet)).not.toContain('SUPERSECRET');
    expect(snippet.widget.config.apiKey).toBe(''); // provider default
    expect(snippet.widget.config.maxItems).toBe(6);
  });

  it('blanks widget-reference fields (computed sources)', () => {
    const snippet = widgetToSnippet({
      id: 'w-3',
      type: 'computed',
      size: { w: 1, h: 1 },
      config: { label: 'Avg', operation: 'weekly-average', sourceA: 'w-someone-elses-id', sourceB: '', unit: '', decimals: 0, direction: 'up-good', pollMinutes: 15 },
    });
    expect(snippet.widget.config.sourceA).toBe('');
    expect(snippet.widget.config.operation).toBe('weekly-average');
  });
});

describe('snippetToInstance', () => {
  it('round-trips a shared widget with a fresh id', () => {
    const original = restWidget();
    const text = JSON.stringify(widgetToSnippet(original));
    const { instance, provider } = snippetToInstance(text);
    expect(provider.type).toBe('rest-api');
    expect(instance.id).not.toBe(original.id);
    expect(instance.title).toBe('GitHub stars');
    expect(instance.size).toEqual({ w: 2, h: 1 });
    expect(instance.goal).toEqual({ value: 2000, direction: 'at-least' });
    expect(instance.config.valuePath).toBe('stargazers_count');
  });

  it('ignores secrets smuggled into a hand-crafted snippet', () => {
    const text = JSON.stringify({
      app: 'panodash',
      kind: 'widget',
      version: 1,
      widget: {
        type: 'linear-tasks',
        size: { w: 2, h: 2 },
        config: { apiKey: 'attacker-planted', maxItems: 4, injected: 'nope' },
      },
    });
    const { instance } = snippetToInstance(text);
    expect(instance.config.apiKey).toBe('');
    expect(instance.config.maxItems).toBe(4);
    expect('injected' in instance.config).toBe(false);
  });

  it('rejects non-JSON, non-snippets, and unknown widget types', () => {
    expect(() => snippetToInstance('not json')).toThrow(/JSON/);
    expect(() => snippetToInstance('{"kind":"backup"}')).toThrow(/snippet/);
    expect(() => snippetToInstance(JSON.stringify({ kind: 'widget', widget: { type: 'from-the-future' } }))).toThrow(
      /from-the-future/,
    );
  });

  it('clamps absurd sizes and drops malformed goals', () => {
    const text = JSON.stringify({
      kind: 'widget',
      widget: {
        type: 'clock',
        size: { w: 99, h: -3 },
        goal: { value: 'not-a-number', direction: 'sideways' },
        config: { hour12: '24' },
      },
    });
    const { instance } = snippetToInstance(text);
    expect(instance.size).toEqual({ w: 4, h: 1 });
    expect(instance.goal).toBeUndefined();
    expect(instance.config.hour12).toBe('24');
  });

  it('coerces field values to their declared shapes', () => {
    const provider = getProvider('rest-api')!;
    const config = sanitizeConfig(provider, {
      pollMinutes: '45',
      decimals: 2,
      direction: 'bogus-option',
      url: 12345,
    });
    expect(config.pollMinutes).toBe(45);
    expect(config.decimals).toBe(2);
    expect(config.direction).toBe('up-good'); // invalid select value → default
    expect(config.url).toBe('12345'); // stringified
  });
});
