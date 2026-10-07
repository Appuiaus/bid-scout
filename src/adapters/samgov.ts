// SAM.gov "Get Opportunities" public API (v2). Official and free.
// Rate limit: 10 calls/day for a key with no SAM role, 1,000 with one. So we
// make ONE call per NAICS code per run, and the board config sets the codes.

import type { Adapter, AdapterContext, NormalizedListing } from "./types";
import { stateFromText, stateFromZip } from "./usstate";

const DEFAULT_ENDPOINT = "https://api.sam.gov/opportunities/v2/search";

// Work-type tags implied by each NAICS code, so trade matching has something
// to work with when the notice title is terse.
export const NAICS_TAGS: Record<string, string[]> = {
  "238910": ["site preparation", "excavation", "grading"],
  "237310": ["roadway", "paving"],
  "237110": ["site utilities", "water main", "sewer"],
  "237990": ["earthwork"],
  // Commercial building: much federal sitework is filed here, but so is pure
  // vertical work. No implied tags, so a listing only scores well when its own
  // text shows earthwork (otherwise the no-earthwork cap keeps it below 35).
  "236220": [],
};

// Notice types that are an actual (or upcoming) chance to bid.
const BIDDABLE_TYPES = ["solicitation", "combined synopsis/solicitation", "presolicitation"];

interface SamNotice {
  noticeId: string;
  title: string;
  solicitationNumber?: string;
  type?: string;
  baseType?: string;
  postedDate?: string;
  responseDeadLine?: string | null;
  naicsCode?: string;
  active?: string;
  award?: { amount?: string | number } | null;
  placeOfPerformance?: {
    city?: { name?: string };
    state?: { code?: string };
    zip?: string;
    streetAddress?: string;
  } | null;
  uiLink?: string;
  resourceLinks?: string[] | null;
  fullParentPathName?: string;
}

const mmddyyyy = (d: Date) =>
  `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;

export function mapNotice(n: SamNotice): NormalizedListing | null {
  const type = (n.type ?? n.baseType ?? "").toLowerCase();
  if (!BIDDABLE_TYPES.includes(type)) return null;
  if (n.active && n.active.toLowerCase() === "no") return null;
  const amount = n.award?.amount != null ? Number(n.award.amount) : NaN;
  // About half of real notices leave placeOfPerformance.state empty. Fall back
  // to the job's ZIP code, address or title. Never use officeAddress: the
  // contracting office is often hundreds of miles from the site.
  const pop = n.placeOfPerformance ?? {};
  let state = pop.state?.code || null;
  let stateNote = "";
  if (!state) {
    state = stateFromZip(pop.zip) ?? stateFromText(pop.streetAddress) ?? stateFromText(n.title);
    if (state) stateNote = "state inferred from job address/title";
  }
  return {
    source_reference: n.noticeId,
    title: n.title,
    // The full description needs a second API call per notice (costs quota),
    // so Phase 1 scores on title + agency + NAICS tags only.
    description: [n.fullParentPathName, n.solicitationNumber, n.type, stateNote].filter(Boolean).join(" · ") || null,
    city: n.placeOfPerformance?.city?.name ?? null,
    state,
    lat: null,
    lng: null,
    project_value: Number.isFinite(amount) && amount > 0 ? amount : null,
    work_type_tags: NAICS_TAGS[n.naicsCode ?? ""] ?? [],
    files_present: (n.resourceLinks?.length ?? 0) > 0,
    bid_due_at: n.responseDeadLine ? new Date(n.responseDeadLine).toISOString() : null,
    url: n.uiLink ?? `https://sam.gov/opp/${n.noticeId}/view`,
    raw: n,
  };
}

export const samgov: Adapter = {
  async fetchListings(ctx: AdapterContext) {
    const key = ctx.secrets.SAM_API_KEY;
    if (!key) throw new Error("SAM_API_KEY secret is not set");
    const naics = (ctx.params.naics as string[] | undefined) ?? Object.keys(NAICS_TAGS);
    const lookbackDays = Number(ctx.params.lookback_days ?? 3);
    const from = new Date(ctx.now.getTime() - lookbackDays * 86_400_000);

    const out: NormalizedListing[] = [];
    let calls = 0;
    for (const code of naics) {
      const url = new URL(ctx.board.endpoint || DEFAULT_ENDPOINT);
      url.searchParams.set("api_key", key);
      url.searchParams.set("postedFrom", mmddyyyy(from));
      url.searchParams.set("postedTo", mmddyyyy(ctx.now));
      url.searchParams.set("ncode", code);
      url.searchParams.set("limit", "1000");
      url.searchParams.set("offset", "0");
      calls++;
      const res = await ctx.fetch(url.toString());
      if (res.status === 429) throw new Error(`SAM.gov daily quota exhausted after ${calls} call(s)`);
      if (!res.ok) throw new Error(`SAM.gov ${code}: HTTP ${res.status}`);
      const body = (await res.json()) as { opportunitiesData?: SamNotice[] };
      for (const n of body.opportunitiesData ?? []) {
        const l = mapNotice(n);
        if (l) out.push(l);
      }
    }
    return { listings: out, calls };
  },
};
