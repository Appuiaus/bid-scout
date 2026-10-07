// Bid Scout hub. Phase 1 is READ-ONLY: there are no routes that write to the
// database or to anything outside it. Every request must carry a valid
// Cloudflare Access token.

import { verifyAccess, type AccessEnv } from "./access";

interface Env extends AccessEnv {
  DB: D1Database;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--line:#e7e5e4;--card:#fff;--good:#15803d;--warn:#b45309;--bad:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#1c1917;--fg:#f5f5f4;--muted:#a8a29e;--line:#44403c;--card:#292524;--good:#4ade80;--warn:#fbbf24;--bad:#f87171}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:960px;margin:0 auto;padding:16px}a{color:inherit}
header{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--line);margin-bottom:16px}
.muted{color:var(--muted)}.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;margin:8px 0}
.row{display:flex;justify-content:space-between;gap:12px;align-items:baseline;flex-wrap:wrap}
.score{font-weight:700;font-size:20px;font-variant-numeric:tabular-nums}
.badge{display:inline-block;font-size:12px;padding:1px 6px;border-radius:4px;border:1px solid currentColor}
.low{color:var(--warn)}.drop{color:var(--bad)}
table{width:100%;border-collapse:collapse;font-size:13px}td{padding:2px 6px;border-top:1px solid var(--line);vertical-align:top}
td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
</style></head><body><main>${body}</main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" } },
  );
}

const header = (email: string, crumb = "") =>
  `<header><h1 style="font-size:20px;margin:8px 0"><a href="/" style="text-decoration:none">Bid Scout</a>${crumb}</h1>
   <span class="muted">${esc(email)} · read-only (Phase 1)</span></header>`;

async function home(env: Env, email: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT c.client_id, c.client_name, c.active, c.timezone, c.next_meeting_at,
            SUM(CASE WHEN m.deterministic_pass = 1 AND m.status IN ('new','surfaced') THEN 1 ELSE 0 END) AS queued
       FROM clients c LEFT JOIN matches m ON m.client_id = c.client_id
      GROUP BY c.client_id ORDER BY c.next_meeting_at IS NULL, c.next_meeting_at`,
  ).all<Record<string, unknown>>();
  const runs = await env.DB.prepare(
    `SELECT board_id, status, started_at, fetched, error FROM ingest_runs ORDER BY id DESC LIMIT 5`,
  ).all<Record<string, unknown>>();

  const clients = results.length
    ? results.map((c) => `<div class="card row"><div><a href="/c/${encodeURIComponent(String(c.client_id))}"><b>${esc(c.client_name)}</b></a>
        ${c.active ? "" : ' <span class="badge muted">inactive</span>'}
        <div class="muted">${esc(c.timezone)}${c.next_meeting_at ? ` · next meeting ${esc(c.next_meeting_at)}` : ""}</div></div>
        <div class="score">${Number(c.queued ?? 0)}</div></div>`).join("")
    : `<p class="muted">No clients yet. Add the Phase 1 pilot client (see docs/SETUP.md).</p>`;
  const runList = runs.results.length
    ? runs.results.map((r) => `<div class="muted">${esc(r.started_at)} · ${esc(r.board_id)} · ${esc(r.status)} · ${esc(r.fetched)} fetched${r.error ? ` · <span class="drop">${esc(r.error)}</span>` : ""}</div>`).join("")
    : `<p class="muted">No board runs yet.</p>`;
  return page("Bid Scout", `${header(email)}<h2>Clients</h2>${clients}<h2>Recent board runs</h2>${runList}`);
}

async function clientQueue(env: Env, email: string, clientId: string, showDropped: boolean): Promise<Response> {
  const client = await env.DB.prepare(`SELECT * FROM clients WHERE client_id = ?`).bind(clientId).first<Record<string, unknown>>();
  if (!client) return page("Not found", `${header(email)}<p>Unknown client.</p>`, 404);
  const threshold = Number((await env.DB.prepare(`SELECT value FROM rules WHERE key='surface_threshold'`).first<{ value: string }>())?.value ?? 50);

  const { results } = await env.DB.prepare(
    `SELECT o.*, m.deterministic_pass, m.drop_reason, m.fit_score, m.score_components, m.confidence_flag, m.status
       FROM matches m JOIN opportunities o ON o.opportunity_id = m.opportunity_id
      WHERE m.client_id = ? AND (m.deterministic_pass = 1 OR ? = 1)
      ORDER BY m.deterministic_pass DESC, m.fit_score DESC LIMIT 200`,
  ).bind(clientId, showDropped ? 1 : 0).all<Record<string, unknown>>();

  const items = results.map((o) => {
    const comps = JSON.parse(String(o.score_components || "{}")) as Record<string, { points: number; max: number; note: string }>;
    const below = o.deterministic_pass && Number(o.fit_score) < threshold;
    const table = Object.entries(comps).map(([k, v]) =>
      `<tr><td>${esc(k)}</td><td class="n">${v.points} / ${v.max}</td><td class="muted">${esc(v.note)}</td></tr>`).join("");
    return `<div class="card"><div class="row"><div>
        <b>${o.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">${esc(o.title)}</a>` : esc(o.title)}</b>
        ${o.confidence_flag === "low" ? ' <span class="badge low">low confidence: no value, no files</span>' : ""}
        ${below ? ' <span class="badge muted">below surface threshold</span>' : ""}
        <div class="muted">${esc([o.city, o.state].filter(Boolean).join(", "))} · ${o.project_value != null ? `$${Number(o.project_value).toLocaleString("en-US")}` : "no value"}
          · due ${esc(o.bid_due_at ?? "n/a")} · ${esc(o.source_board)}</div></div>
        <div class="score ${o.deterministic_pass ? "" : "drop"}">${o.deterministic_pass ? esc(o.fit_score) : "dropped"}</div></div>
        ${o.deterministic_pass ? `<table>${table}</table>` : `<div class="drop">${esc(o.drop_reason)}</div>`}</div>`;
  }).join("") || `<p class="muted">Nothing scored for this client yet.</p>`;

  const toggle = showDropped ? `<a href="?">hide dropped</a>` : `<a href="?dropped=1">show dropped</a>`;
  return page(`${client.client_name} · Bid Scout`,
    `${header(email, ` › ${esc(client.client_name)}`)}<div class="row"><span class="muted">Surface threshold ${threshold}</span>${toggle}</div>${items}`);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Read-only in Phase 1", { status: 405 });
    const auth = await verifyAccess(req, env);
    if (!auth.ok) return new Response(auth.reason, { status: auth.status });

    const url = new URL(req.url);
    if (url.pathname === "/") return home(env, auth.email);
    if (url.pathname === "/health") return Response.json({ ok: true, user: auth.email });
    const m = url.pathname.match(/^\/c\/([^/]+)$/);
    if (m) return clientQueue(env, auth.email, decodeURIComponent(m[1]), url.searchParams.get("dropped") === "1");
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
