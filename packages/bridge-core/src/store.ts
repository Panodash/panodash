/**
 * Durable state required by the bridge protocol.
 *
 * Hosted operators can implement this interface with a database and
 * application-layer token encryption. The reference bridge includes a
 * single-process JSON file implementation.
 */
export interface SessionRecord {
  provider: string;
  refreshToken: string;
  accessToken?: string;
  accessExpiresAt?: number;
  createdAt: number;
  lastUsedAt: number;
}

export interface PendingRecord {
  session: string;
  provider: string;
  extensionRedirect: string;
  createdAt: number;
}

export interface Store {
  getSession(id: string): Promise<SessionRecord | undefined>;
  putSession(id: string, record: SessionRecord): Promise<void>;
  deleteSession(id: string): Promise<void>;
  putPending(state: string, record: PendingRecord): Promise<void>;
  /** Single-use: returns and removes the pending record. */
  takePending(state: string): Promise<PendingRecord | undefined>;
  prunePending(ttlMs: number): Promise<void>;
}
