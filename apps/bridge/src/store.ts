/**
 * Session store for the Panodash auth bridge.
 *
 * Two tables:
 * - sessions: session id -> refresh token custody for one connection.
 * - pending:  OAuth state -> the in-flight consent flow it belongs to.
 *
 * Default is in-memory; pass a file path to persist as JSON (written
 * atomically via tmp+rename). The file contains refresh tokens — operators
 * must keep it private (0600) and on an encrypted volume. Instances beyond
 * personal scale should swap this for a real database; the Store interface
 * is the seam.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  PendingRecord,
  SessionRecord,
  Store,
} from '@panodash/bridge-core';

interface StoreData {
  sessions: Record<string, SessionRecord>;
  pending: Record<string, PendingRecord>;
}

export function createStore(filePath?: string): Store {
  let data: StoreData = { sessions: {}, pending: {} };

  if (filePath) {
    try {
      data = JSON.parse(readFileSync(filePath, 'utf8')) as StoreData;
      data.sessions ??= {};
      data.pending ??= {};
    } catch {
      // First run: file doesn't exist yet.
    }
  }

  function save(): void {
    if (!filePath) return;
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    renameSync(tmp, filePath);
  }

  return {
    getSession: async (id) => data.sessions[id],
    putSession: async (id, record) => {
      data.sessions[id] = record;
      save();
    },
    deleteSession: async (id) => {
      delete data.sessions[id];
      save();
    },
    putPending: async (state, record) => {
      data.pending[state] = record;
      save();
    },
    takePending: async (state) => {
      const record = data.pending[state];
      if (record) {
        delete data.pending[state];
        save();
      }
      return record;
    },
    prunePending: async (ttlMs) => {
      const cutoff = Date.now() - ttlMs;
      let dirty = false;
      for (const [state, record] of Object.entries(data.pending)) {
        if (record.createdAt < cutoff) {
          delete data.pending[state];
          dirty = true;
        }
      }
      if (dirty) save();
    },
  };
}
