import type { WidgetProvider } from './types';

const providers = new Map<string, WidgetProvider>();

export function registerProvider(provider: WidgetProvider): void {
  if (providers.has(provider.type)) {
    throw new Error(`Widget provider '${provider.type}' is already registered`);
  }
  providers.set(provider.type, provider);
}

export function getProvider(type: string): WidgetProvider | undefined {
  return providers.get(type);
}

export function allProviders(): WidgetProvider[] {
  return [...providers.values()];
}
