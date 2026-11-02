// HTTP server: serves the client files and the sync API. Uses only Node's built-in modules (nothing to install).
//
//   POST /api/plans/sync      send one plan (idempotent)
//   GET  /api/plans/:id       read a plan as the server has it
//   GET  /api/config          { demo }
//   POST /api/demo/edit/:id   only with --demo: simulate an edit from another device

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSyncService } from "./syncService.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_DIR = path.join(ROOT, "client");
const DEFAULT_DATA_FILE = path.join(ROOT, "server", "data", "plans.json");
const MAX_BODY = 100_000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/** JSON file storage. Writes to a temp file then renames, so a crash cannot leave half a file. */
export function fileRepo(file) {
  return {
    load() {
      try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (err) {
        if (err.code === "ENOENT") return {};
        throw err;
      }
    },
    save(data) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, file);
    },
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) tooBig = true;
      else chunks.push(c);
    });
    req.on("end", () => {
      if (tooBig) return reject(Object.assign(new Error("Request too large."), { status: 413 }));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "null"));
      } catch {
        reject(Object.assign(new Error("Request body is not valid JSON."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

const sendJson = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
};

export function createApp({ dataFile = DEFAULT_DATA_FILE, demo = false } = {}) {
  const service = createSyncService(fileRepo(dataFile));

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");

      if (url.pathname.startsWith("/api/")) {
        const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
        if (req.method === "GET" && url.pathname === "/api/config") return sendJson(res, 200, { demo });
        if (req.method === "POST" && url.pathname === "/api/plans/sync") {
          const out = service.sync(await readJson(req));
          return sendJson(res, out.status, out.body);
        }
        if (req.method === "GET" && parts[1] === "plans" && parts.length === 3) {
          const rec = service.get(decodeURIComponent(parts[2]));
          return rec ? sendJson(res, 200, rec) : sendJson(res, 404, { code: "NOT_FOUND" });
        }
        if (demo && req.method === "POST" && parts[1] === "demo" && parts[2] === "edit" && parts.length === 4) {
          const rec = service.demoEdit(decodeURIComponent(parts[3]));
          return rec ? sendJson(res, 200, { version: rec.version }) : sendJson(res, 404, { code: "NOT_FOUND" });
        }
        return sendJson(res, 404, { code: "NOT_FOUND" });
      }

      // Static files. Block path traversal: the resolved file must stay inside the client folder.
      let rel = decodeURIComponent(url.pathname);
      if (rel === "/") rel = "/index.html";
      const file = path.normalize(path.join(CLIENT_DIR, rel));
      if (!file.startsWith(CLIENT_DIR + path.sep)) {
        res.writeHead(403, { "Content-Type": "text/plain" }).end("Forbidden");
        return;
      }
      const body = await fsp.readFile(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
      res.end(body);
    } catch (err) {
      if (err.status) return sendJson(res, err.status, { code: "BAD_REQUEST", message: err.message });
      if (err.code === "ENOENT" || err.code === "EISDIR") {
        res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      } else {
        console.error(err);
        sendJson(res, 500, { code: "SERVER_ERROR", message: "Something went wrong on the server." });
      }
    }
  });
  server.service = service;
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const demo = process.argv.includes("--demo");
  createApp({ demo }).listen(port, () =>
    console.log(`STEMMate slice running at http://localhost:${port}${demo ? "  (demo tools on)" : ""}`)
  );
}
