// Minimal HTTP server. Part 1: serves the client files. Part 2 adds the sync API.
// Uses only Node's built-in modules, so there is nothing to install.

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_DIR = path.join(ROOT, "client");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export function createApp() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let rel = decodeURIComponent(url.pathname);
      if (rel === "/") rel = "/index.html";

      // Block path traversal: the resolved file must stay inside the client folder.
      const file = path.normalize(path.join(CLIENT_DIR, rel));
      if (!file.startsWith(CLIENT_DIR + path.sep)) {
        res.writeHead(403, { "Content-Type": "text/plain" }).end("Forbidden");
        return;
      }
      const body = await fs.readFile(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
      res.end(body);
    } catch (err) {
      if (err.code === "ENOENT" || err.code === "EISDIR") {
        res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      } else {
        res.writeHead(500, { "Content-Type": "text/plain" }).end("Server error");
      }
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => console.log(`STEMMate slice running at http://localhost:${port}`));
}
