/**
 * Serve the dashboard locally at http://localhost:3002.
 *
 *   npm run dashboard
 *
 * Why a tiny server instead of opening the file: browsers block fetch() of data.json from a
 * file:// page. Why port 3002: the jev-state playground uses 3000 and the game uses 3001.
 * Why no dependency: twenty lines of node:http is enough for three static files.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "docs");
const PORT = 3002;
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

createServer(async (req, res) => {
  // Resolve the path inside docs/ only, so a request like /../.env can never leave the folder.
  const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = join(ROOT, path.endsWith("/") ? `${path}index.html` : path);
  if (!file.startsWith(ROOT)) return void res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(PORT, () => console.log(`Dashboard: http://localhost:${PORT}`));
