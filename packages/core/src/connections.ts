import { storageGet, storageKeys, storageRemove, storageSet } from './storage';

interface LocalConnection {
  secret: string;
  updatedAt: number;
}

const PREFIX = 'connection:';

/** What management surfaces are allowed to see about a saved secret: enough
 *  to recognise which token is stored, never enough to reuse it. */
export interface ConnectionMeta {
  id: string;
  updatedAt: number;
  /** Masked tail, e.g. '••••4f21'. Short secrets are masked entirely. */
  hint: string;
}

function connectionKey(id: string): string {
  return `${PREFIX}${id}`;
}

/** Mask a secret down to a recognisable tail. Pure — unit tested. */
export function maskSecret(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length <= 8) return '••••';
  return `••••${trimmed.slice(-4)}`;
}

export async function getConnectionSecret(id: string): Promise<string | undefined> {
  const connection = await storageGet<LocalConnection>(connectionKey(id));
  const secret = connection?.secret.trim();
  return secret || undefined;
}

export async function hasLocalConnection(id: string): Promise<boolean> {
  return !!(await getConnectionSecret(id));
}

export async function getConnectionMeta(id: string): Promise<ConnectionMeta | undefined> {
  const connection = await storageGet<LocalConnection>(connectionKey(id));
  const secret = connection?.secret.trim();
  if (!secret) return undefined;
  return { id, updatedAt: connection!.updatedAt, hint: maskSecret(secret) };
}

/** Metadata for every saved connection, including ones whose provider is no
 *  longer registered — those would otherwise be unreachable secrets. */
export async function listConnectionMeta(): Promise<ConnectionMeta[]> {
  const keys = await storageKeys(PREFIX);
  const entries = await Promise.all(
    keys.map((key) => getConnectionMeta(key.slice(PREFIX.length))),
  );
  return entries
    .filter((entry): entry is ConnectionMeta => !!entry)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function saveLocalConnection(id: string, secret: string): Promise<void> {
  const trimmed = secret.trim();
  if (!trimmed) throw new Error('Connection secret cannot be empty');
  await storageSet(connectionKey(id), { secret: trimmed, updatedAt: Date.now() } satisfies LocalConnection);
}

export async function removeLocalConnection(id: string): Promise<void> {
  await storageRemove(connectionKey(id));
}
