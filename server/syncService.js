// Server-side sync rules (FR-05, FR-06, SUS-01). Pure logic: storage is injected, so tests need no files or network.
//
// Rules:
//  - A plan is identified by the id the client made, so a retry can never create a second copy.
//  - Same id + same revision + same content  -> replay of an earlier request: answer "ok", change nothing.
//  - baseVersion (the server version the client last saw) differs from the server's version -> CONFLICT (409).
//    The server never overwrites newer data silently; the client must choose.
//  - Only complete plans are accepted (same validation as the client).

import crypto from "node:crypto";
import { validateForReady, FIELDS } from "../client/js/validation.js";

const trimmed = (v) => (typeof v === "string" ? v.trim() : "");
const contentOf = (p) => Object.fromEntries(FIELDS.map(({ key }) => [key, trimmed(p[key])]));
export const hashContent = (p) => crypto.createHash("sha256").update(JSON.stringify(contentOf(p))).digest("hex");

const reply = (status, body) => ({ status, body });

export function createSyncService(repo, { now = () => new Date() } = {}) {
  return {
    sync(payload) {
      if (
        !payload || typeof payload !== "object" ||
        typeof payload.id !== "string" || !payload.id || payload.id.length > 100 ||
        !Number.isInteger(payload.revision) || payload.revision < 1 ||
        !Number.isInteger(payload.baseVersion) || payload.baseVersion < 0
      ) {
        return reply(400, { code: "BAD_REQUEST", message: "The request was not understood." });
      }

      const { valid, errors } = validateForReady(payload);
      if (!valid) return reply(422, { code: "INVALID", message: "The plan is incomplete.", errors });

      const records = repo.load();
      const existing = records[payload.id];
      const hash = hashContent(payload);

      if (existing && existing.revision === payload.revision && existing.hash === hash) {
        return reply(200, { code: "OK", duplicate: true, serverId: existing.serverId, version: existing.version });
      }

      if ((existing?.version ?? 0) !== payload.baseVersion) {
        return reply(409, {
          code: "CONFLICT",
          message: "This plan was changed somewhere else.",
          server: { serverId: existing.serverId, version: existing.version, content: existing.content },
        });
      }

      const record = {
        id: payload.id,
        serverId: existing?.serverId ?? `srv-${crypto.randomUUID()}`,
        version: (existing?.version ?? 0) + 1,
        revision: payload.revision,
        hash,
        content: contentOf(payload),
        updatedAt: now().toISOString(),
      };
      records[payload.id] = record;
      repo.save(records);
      return reply(existing ? 200 : 201, { code: "OK", duplicate: false, serverId: record.serverId, version: record.version });
    },

    get(id) {
      return repo.load()[id] ?? null;
    },

    count() {
      return Object.keys(repo.load()).length;
    },

    /** Demo only: pretend another device edited the plan, so the conflict path can be shown. */
    demoEdit(id) {
      const records = repo.load();
      const rec = records[id];
      if (!rec) return null;
      rec.version += 1;
      rec.content = { ...rec.content, title: `${rec.content.title} (edited on another device)`.slice(0, 80) };
      rec.hash = hashContent(rec.content);
      rec.updatedAt = now().toISOString();
      repo.save(records);
      return rec;
    },
  };
}

/** In-memory repo, used by tests. */
export function memoryRepo() {
  let data = {};
  return { load: () => structuredClone(data), save: (d) => { data = structuredClone(d); } };
}
