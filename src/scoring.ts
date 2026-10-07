// Deterministic pre-filter + explainable fit score. Pure functions, no I/O,
// so they run at near-zero cost and are easy to test against Ben's judgement.

export interface ClientProfile {
  client_id: string;
  work_types: string[];
  states: string[];
  base_lat: number | null;
  base_lng: number | null;
  radius_miles: number | null;
  value_min: number | null;
  value_max: number | null;
  include_unvalued_listings: boolean;
  positive_markers: string[];
  negative_markers: string[];
}

export interface Listing {
  title: string;
  description: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  project_value: number | null;
  work_type_tags: string[];
  files_present: boolean;
  bid_due_at: string | null;
}

export interface Weights {
  location: number;
  trade: number;
  markers: number;
  value: number;
  recency: number;
  completeness: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  location: 25, trade: 25, markers: 20, value: 15, recency: 10, completeness: 5,
};

// Terms that suggest earthwork even when "sitework" itself is absent.
// Weaker than the client's own positive markers.
const EARTHWORK_TERMS = [
  "grading", "excavation", "earthwork", "cut and fill", "cut & fill", "site prep",
  "site preparation", "site utilities", "underground utilities", "storm drain",
  "sewer", "water main", "paving", "asphalt", "clearing", "grubbing", "pond",
  "detention", "retention", "roadway", "subgrade", "over excavation", "overexcavation",
];

export interface Component {
  points: number;
  max: number;
  note: string;
}

// Listings with no earthwork signal at all (no marker, no earthwork term, no
// work-type match) can still be in-area and in-bracket. Cap them so pure
// vertical work stays below the surface threshold, but remains visible.
export const NO_EARTHWORK_CAP = 35;

export type Components = Record<keyof Weights, Component> & { cap?: Component };

export interface ScoreResult {
  deterministic_pass: boolean;
  drop_reason: string | null;
  fit_score: number | null;
  components: Components | null;
  confidence_flag: "normal" | "low";
  matched_positive: string[];
  matched_negative: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function findTerms(text: string, terms: string[]): string[] {
  const t = norm(text);
  return terms.filter((term) => {
    const n = norm(term);
    return n.length > 0 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t);
  });
}

export function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(a));
}

function locationFit(c: ClientProfile, l: Listing): { fit: number | null; note: string } {
  const hasRadius = c.base_lat != null && c.base_lng != null && c.radius_miles != null;
  if (hasRadius && l.lat != null && l.lng != null) {
    const d = milesBetween(c.base_lat!, c.base_lng!, l.lat, l.lng);
    if (d > c.radius_miles!) return { fit: null, note: `${Math.round(d)} mi away, outside ${c.radius_miles} mi radius` };
    // Full marks inside half the radius, tapering to 50% at the edge.
    const fit = d <= c.radius_miles! / 2 ? 1 : 1 - 0.5 * ((d - c.radius_miles! / 2) / (c.radius_miles! / 2));
    return { fit, note: `${Math.round(d)} mi from base` };
  }
  if (c.states.length > 0) {
    if (!l.state) return { fit: 0.5, note: "listing has no state; not verified" };
    const ok = c.states.map((s) => s.toUpperCase()).includes(l.state.toUpperCase());
    return ok ? { fit: 1, note: `in ${l.state.toUpperCase()}` } : { fit: null, note: `${l.state} not in service area` };
  }
  return { fit: 0.5, note: "client has no service area set" };
}

function valueFit(c: ClientProfile, l: Listing): { fit: number | null; note: string } {
  if (l.project_value == null) {
    return c.include_unvalued_listings
      ? { fit: 0.5, note: "no value stated (neutral)" }
      : { fit: null, note: "no value stated and client excludes unvalued listings" };
  }
  const v = l.project_value;
  if (c.value_min != null && v < c.value_min) return { fit: null, note: `$${v.toLocaleString("en-US")} below min` };
  if (c.value_max != null && v > c.value_max) return { fit: null, note: `$${v.toLocaleString("en-US")} above max` };
  return { fit: 1, note: `$${v.toLocaleString("en-US")} within bracket` };
}

function recencyFit(l: Listing, now: Date): { fit: number | null; note: string } {
  if (!l.bid_due_at) return { fit: 0.5, note: "no due date" };
  const days = (new Date(l.bid_due_at).getTime() - now.getTime()) / 86_400_000;
  if (Number.isNaN(days)) return { fit: 0.5, note: "unreadable due date" };
  if (days < 0) return { fit: null, note: "bid due date has passed" };
  if (days < 3) return { fit: 0.3, note: `due in ${days.toFixed(1)} days (tight)` };
  if (days <= 30) return { fit: 1, note: `due in ${Math.round(days)} days` };
  return { fit: 0.7, note: `due in ${Math.round(days)} days (far out)` };
}

export function scoreListing(c: ClientProfile, l: Listing, weights: Weights = DEFAULT_WEIGHTS, now = new Date()): ScoreResult {
  // Markers are judged on the listing's own words only. Tags inferred from a
  // board's category code (e.g. NAICS) help trade matching but must not
  // override what the listing itself says ("interior renovation" stays negative).
  const ownText = [l.title, l.description ?? ""].join(" ");
  const text = [ownText, l.work_type_tags.join(" ")].join(" ");
  const matched_positive = findTerms(ownText, c.positive_markers);
  const matched_negative = findTerms(ownText, c.negative_markers);
  const earthwork = findTerms(ownText, EARTHWORK_TERMS);
  const confidence_flag: "normal" | "low" = l.project_value == null && !l.files_present ? "low" : "normal";

  const drop = (reason: string): ScoreResult => ({
    deterministic_pass: false, drop_reason: reason, fit_score: null, components: null,
    confidence_flag, matched_positive, matched_negative,
  });

  // ---- Stage 1: hard filters ----
  const loc = locationFit(c, l);
  if (loc.fit == null) return drop(loc.note);
  const val = valueFit(c, l);
  if (val.fit == null) return drop(val.note);
  const rec = recencyFit(l, now);
  if (rec.fit == null) return drop(rec.note);
  if (matched_negative.length > 0 && matched_positive.length === 0 && earthwork.length === 0) {
    return drop(`negative marker (${matched_negative.join(", ")}) with no sitework signal`);
  }

  // ---- Stage 2: weighted components ----
  const clientTypes = c.work_types.map(norm);
  const tradeHits = findTerms(text, clientTypes);
  const tradeFit = clientTypes.length === 0 ? 0.5 : Math.min(1, tradeHits.length / Math.min(2, clientTypes.length));

  let markerFit = 0;
  if (matched_positive.length > 0) markerFit = 1;
  else if (earthwork.length > 0) markerFit = Math.min(0.7, 0.35 * earthwork.length);
  if (matched_negative.length > 0) markerFit = Math.max(0, markerFit - 0.4);

  const completeness = (l.project_value != null ? 0.4 : 0) + (l.files_present ? 0.4 : 0) + ((l.description ?? "").length > 40 ? 0.2 : 0);

  const mk = (fit: number, max: number, note: string): Component => ({ points: Math.round(fit * max * 10) / 10, max, note });
  const components: Components = {
    location: mk(loc.fit, weights.location, loc.note),
    trade: mk(tradeFit, weights.trade, tradeHits.length ? `matches: ${tradeHits.join(", ")}` : "no work-type match in text"),
    markers: mk(markerFit, weights.markers,
      [matched_positive.length ? `+ ${matched_positive.join(", ")}` : "",
       !matched_positive.length && earthwork.length ? `earthwork terms: ${earthwork.join(", ")}` : "",
       matched_negative.length ? `− ${matched_negative.join(", ")}` : ""].filter(Boolean).join("; ") || "no markers"),
    value: mk(val.fit, weights.value, val.note),
    recency: mk(rec.fit, weights.recency, rec.note),
    completeness: mk(completeness, weights.completeness,
      [l.project_value != null ? "value" : "", l.files_present ? "files" : "", (l.description ?? "").length > 40 ? "scope text" : ""]
        .filter(Boolean).join(" + ") || "no value, files or scope"),
  };
  const max = Object.values(weights).reduce((s, x) => s + x, 0);
  let score = Math.round((Object.values(components).reduce((s, x) => s + x.points, 0) / max) * 100);
  if (matched_positive.length === 0 && earthwork.length === 0 && tradeHits.length === 0 && score > NO_EARTHWORK_CAP) {
    components.cap = {
      points: -Math.round(((score - NO_EARTHWORK_CAP) / 100) * max * 10) / 10, max: 0,
      note: `no earthwork signal; capped at ${NO_EARTHWORK_CAP}`,
    };
    score = NO_EARTHWORK_CAP;
  }
  return {
    deterministic_pass: true, drop_reason: null,
    fit_score: score, components,
    confidence_flag, matched_positive, matched_negative,
  };
}
