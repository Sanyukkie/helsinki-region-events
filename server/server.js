import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { db } from "./db.js";
import { runIngest, runIncremental, rebuildCanonical } from "./ingest.js";

const PORT = Number(process.env.PORT || 4173);
const INGEST_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INCREMENTAL_INTERVAL_MS = 15 * 60 * 1000;
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/manifest+json",
};

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function apiEvents(res, query) {
  const page = Math.max(1, Number(query.get("page") || 1));
  const pageSize = Math.min(100, Math.max(1, Number(query.get("page_size") || 24)));
  const where = [];
  const params = [];

  const start = query.get("start");
  if (start) { where.push("COALESCE(end_time, start_time) >= ?"); params.push(`${start}T00:00:00`); }
  const end = query.get("end");
  if (end) { where.push("start_time <= ?"); params.push(`${end}T23:59:59`); }
  const cleanCats = (v) => (v || "").split(",").map((c) => c.replace(/[^a-z]/g, "")).filter(Boolean);
  // categories=a,b → include any of (OR); exclude=c,d → hide all of (AND NOT)
  const include = cleanCats(query.get("categories") || query.get("category"));
  if (include.length) {
    where.push(`(${include.map(() => "categories LIKE ?").join(" OR ")})`);
    params.push(...include.map((c) => `%"${c}"%`));
  }
  const exclude = cleanCats(query.get("exclude"));
  for (const c of exclude) {
    where.push("categories NOT LIKE ?");
    params.push(`%"${c}"%`);
  }
  const text = query.get("text");
  if (text) {
    where.push("(title LIKE ? OR description LIKE ? OR venue_name LIKE ?)");
    const like = `%${text}%`;
    params.push(like, like, like);
  }
  if (query.get("free") === "1") where.push("is_free = 1");

  // keys=a,b,c → exact stable-key lookup (favorites, share links); skips the ongoing split
  const keys = (query.get("keys") || "").split(",").filter(Boolean).slice(0, 200);
  let orderSql;
  if (keys.length) {
    where.push(`stable_key IN (${keys.map(() => "?").join(",")})`);
    params.push(...keys);
    orderSql = "start_time";
  } else {
    // dated events by default; ongoing=1 switches to exhibitions & long-running things
    const ongoingView = query.get("ongoing") === "1";
    where.push(ongoingView ? "is_ongoing = 1" : "COALESCE(is_ongoing, 0) = 0");
    // exhibitions: ending soonest first; dated events: chronological by day,
    // ranked by relevance score within each day (mid-run events count as today)
    orderSql = ongoingView
      ? "COALESCE(end_time, start_time)"
      : "max(date(start_time), date('now')), score DESC, start_time";
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const count = db.prepare(`SELECT COUNT(*) AS n FROM events ${whereSql}`).get(...params).n;
  const rows = db.prepare(`
    SELECT * FROM events ${whereSql}
    ORDER BY ${orderSql} LIMIT ? OFFSET ?
  `).all(...params, pageSize, (page - 1) * pageSize);

  json(res, 200, {
    meta: { count, page, page_size: pageSize, has_more: page * pageSize < count },
    data: rows.map((r) => ({
      ...r,
      categories: JSON.parse(r.categories || "[]"),
      sources: JSON.parse(r.sources || "[]"),
    })),
  });
}

function apiStatus(res) {
  const sources = db.prepare("SELECT * FROM ingest_log").all();
  const total = db.prepare("SELECT COUNT(*) AS n FROM events").get().n;
  json(res, 200, { events: total, sources });
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/api/events") return apiEvents(res, url.searchParams);
  if (url.pathname === "/api/status") return apiStatus(res);
  return serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`Helsinki events aggregator: http://localhost:${PORT}`);
  const eventCount = db.prepare("SELECT COUNT(*) AS n FROM events").get().n;
  const lastRun = db.prepare("SELECT MAX(ran_at) AS t FROM ingest_log").get().t;
  const stale = !lastRun || Date.now() - Date.parse(lastRun) > INGEST_INTERVAL_MS;
  if (eventCount === 0 || stale) {
    console.log("[ingest] database empty or stale — ingesting now (first run takes a minute)…");
    runIngest();
  } else {
    // data is fresh, but dedup/classification code may have changed — rebuild is cheap
    rebuildCanonical();
  }
  setInterval(runIngest, INGEST_INTERVAL_MS);
  setInterval(runIncremental, INCREMENTAL_INTERVAL_MS);
});
