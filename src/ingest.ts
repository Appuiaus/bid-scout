// Runs board adapters, stores what they return, and scores each listing for
// every active client that searches that board. Each board runs in isolation:
// one failing board is logged and does not stop the others.
// Writes go ONLY to this system's own D1 database.

import type { Adapter, BoardRow, NormalizedListing } from "./adapters/types";
import { samgov } from "./adapters/samgov";
import { DEFAULT_WEIGHTS, scoreListing, type ClientProfile, type Weights } from "./scoring";

export const ADAPTERS: Record<string, Adapter> = {
  samgov,
};

export interface IngestEnv {
  DB: D1Database;
  SAM_API_KEY?: string;
}

const j = <T>(s: unknown, fallback: T): T => {
  try { return s == null ? fallback : (JSON.parse(String(s)) as T); } catch { return fallback; }
};

export function dedupeKey(l: Pick<NormalizedListing, "title" | "state">): string {
  return `${(l.state ?? "").toUpperCase()}|${l.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
}

export function toClientProfile(r: Record<string, unknown>): ClientProfile {
  return {
    client_id: String(r.client_id),
    work_types: j(r.work_types, []),
    states: j(r.states, []),
    base_lat: (r.base_lat as number | null) ?? null,
    base_lng: (r.base_lng as number | null) ?? null,
    radius_miles: (r.radius_miles as number | null) ?? null,
    value_min: (r.value_min as number | null) ?? null,
    value_max: (r.value_max as number | null) ?? null,
    include_unvalued_listings: Boolean(r.include_unvalued_listings),
    positive_markers: j(r.positive_markers, ["sitework"]),
    negative_markers: j(r.negative_markers, []),
  };
}

async function runBoard(env: IngestEnv, board: BoardRow, now: Date): Promise<void> {
  const run = await env.DB.prepare(`INSERT INTO ingest_runs (board_id) VALUES (?) RETURNING id`)
    .bind(board.board_id).first<{ id: number }>();
  const runId = run!.id;
  try {
    const adapter = ADAPTERS[board.board_id];
    if (!adapter) throw new Error(`no adapter registered for ${board.board_id}`);
    const { listings: fetched } = await adapter.fetchListings({
      board, now, fetch: (...a) => fetch(...a),
      params: j(board.search_parameter_mapping, {}),
      secrets: { SAM_API_KEY: env.SAM_API_KEY },
    });
    // A notice can come back under more than one search; keep one per id.
    const listings = [...new Map(fetched.map((l) => [l.source_reference, l])).values()];

    const [clientRows, weightsRow] = await Promise.all([
      env.DB.prepare(`SELECT * FROM clients WHERE active = 1`).all<Record<string, unknown>>(),
      env.DB.prepare(`SELECT value FROM rules WHERE key = 'weights'`).first<{ value: string }>(),
    ]);
    const weights: Weights = { ...DEFAULT_WEIGHTS, ...j(weightsRow?.value, {}) };
    const clients = clientRows.results
      .filter((c) => j<string[]>(c.boards_to_search, []).includes(board.board_id))
      .map(toClientProfile);

    const stmts: D1PreparedStatement[] = [];
    for (const l of listings) {
      const oppId = `${board.board_id}:${l.source_reference}`;
      stmts.push(env.DB.prepare(
        `INSERT INTO opportunities (opportunity_id, source_board, source_reference, dedupe_key, title, description,
           city, state, lat, lng, project_value, work_type_tags, files_present, url, bid_due_at, raw_payload)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (source_board, source_reference) DO UPDATE SET
           title=excluded.title, description=excluded.description, city=excluded.city, state=excluded.state,
           project_value=excluded.project_value, work_type_tags=excluded.work_type_tags,
           files_present=excluded.files_present, url=excluded.url, bid_due_at=excluded.bid_due_at,
           raw_payload=excluded.raw_payload`,
      ).bind(oppId, board.board_id, l.source_reference, dedupeKey(l), l.title, l.description, l.city, l.state,
        l.lat, l.lng, l.project_value, JSON.stringify(l.work_type_tags), l.files_present ? 1 : 0, l.url,
        l.bid_due_at, JSON.stringify(l.raw)));

      for (const c of clients) {
        const r = scoreListing(c, l, weights, now);
        // Re-score only while undecided: never overwrite Ben's approve/reject.
        stmts.push(env.DB.prepare(
          `INSERT INTO matches (opportunity_id, client_id, deterministic_pass, drop_reason, fit_score, score_components, confidence_flag)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT (opportunity_id, client_id) DO UPDATE SET
             deterministic_pass=excluded.deterministic_pass, drop_reason=excluded.drop_reason,
             fit_score=excluded.fit_score, score_components=excluded.score_components,
             confidence_flag=excluded.confidence_flag, scored_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
           WHERE matches.status = 'new'`,
        ).bind(oppId, c.client_id, r.deterministic_pass ? 1 : 0, r.drop_reason, r.fit_score,
          JSON.stringify(r.components ?? {}), r.confidence_flag));
      }
    }
    // D1 batches are transactional; chunk to stay well inside per-batch limits.
    for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));

    await env.DB.prepare(`UPDATE ingest_runs SET status='ok', fetched=?, finished_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`)
      .bind(listings.length, runId).run();
  } catch (e) {
    await env.DB.prepare(`UPDATE ingest_runs SET status='failed', error=?, finished_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`)
      .bind(String((e as Error).message ?? e).slice(0, 500), runId).run();
  }
}

export async function runAllBoards(env: IngestEnv, now = new Date()): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM boards WHERE enabled = 1 AND access_type IN ('api','webhook')`,
  ).all<BoardRow>();
  for (const b of results) await runBoard(env, b, now);
}
