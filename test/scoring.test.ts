import { describe, expect, it } from "vitest";
import { scoreListing, type ClientProfile, type Listing } from "../src/scoring";

const now = new Date("2026-10-07T00:00:00Z");
const client: ClientProfile = {
  client_id: "pilot",
  work_types: ["grading", "excavation", "site utilities", "paving"],
  states: ["TX"],
  base_lat: null, base_lng: null, radius_miles: null,
  value_min: 100_000, value_max: 5_000_000,
  include_unvalued_listings: true,
  positive_markers: ["sitework"],
  negative_markers: ["tenant improvement", "tenant build-out", "interior renovation"],
};
const base: Listing = {
  title: "", description: null, state: "TX", lat: null, lng: null,
  project_value: 1_200_000, work_type_tags: [], files_present: true, bid_due_at: "2026-10-20T17:00:00Z",
};

describe("Ben's rules", () => {
  it("new build with sitework scores high", () => {
    const r = scoreListing(client, { ...base, title: "New Distribution Warehouse", description: "Sitework, mass grading, underground utilities and paving for a 200k sf warehouse" }, undefined, now);
    expect(r.deterministic_pass).toBe(true);
    expect(r.fit_score).toBeGreaterThanOrEqual(80);
    expect(r.matched_positive).toContain("sitework");
  });

  it("interior tenant build-out is dropped", () => {
    const r = scoreListing(client, { ...base, title: "Suite 200 Tenant Improvement", description: "Interior renovation of office space" }, undefined, now);
    expect(r.deterministic_pass).toBe(false);
    expect(r.drop_reason).toMatch(/negative marker/);
  });

  it("tenant improvement that ALSO has sitework is kept but penalised", () => {
    const r = scoreListing(client, { ...base, title: "Retail tenant improvement with new parking lot sitework" }, undefined, now);
    expect(r.deterministic_pass).toBe(true);
    expect(r.components!.markers.points).toBeLessThan(r.components!.markers.max);
  });

  it("out of state is dropped before scoring", () => {
    const r = scoreListing(client, { ...base, title: "Sitework package", state: "OK" }, undefined, now);
    expect(r.deterministic_pass).toBe(false);
  });

  it("outside value bracket is dropped", () => {
    expect(scoreListing(client, { ...base, title: "Sitework", project_value: 20_000 }, undefined, now).deterministic_pass).toBe(false);
    expect(scoreListing(client, { ...base, title: "Sitework", project_value: 90_000_000 }, undefined, now).deterministic_pass).toBe(false);
  });

  it("no value + no files is flagged low confidence, not silently dropped", () => {
    const r = scoreListing(client, { ...base, title: "Pond excavation and clearing", project_value: null, files_present: false }, undefined, now);
    expect(r.deterministic_pass).toBe(true);
    expect(r.confidence_flag).toBe("low");
  });

  it("unvalued listings are dropped when the client opts out", () => {
    const r = scoreListing({ ...client, include_unvalued_listings: false }, { ...base, title: "Sitework", project_value: null }, undefined, now);
    expect(r.deterministic_pass).toBe(false);
  });

  it("past due date is dropped", () => {
    expect(scoreListing(client, { ...base, title: "Sitework", bid_due_at: "2026-10-01T00:00:00Z" }, undefined, now).deterministic_pass).toBe(false);
  });

  it("vertical-only build with no earthwork scores low", () => {
    const r = scoreListing(client, { ...base, title: "5-storey office tower, structural steel and curtain wall" }, undefined, now);
    expect(r.fit_score!).toBeLessThan(50);
  });

  it("radius mode drops listings beyond the radius", () => {
    const c = { ...client, states: [], base_lat: 32.7767, base_lng: -96.797, radius_miles: 100 }; // Dallas
    const houston = { ...base, title: "Sitework", lat: 29.7604, lng: -95.3698 };
    const fortWorth = { ...base, title: "Sitework", lat: 32.7555, lng: -97.3308 };
    expect(scoreListing(c, houston, undefined, now).deterministic_pass).toBe(false);
    expect(scoreListing(c, fortWorth, undefined, now).deterministic_pass).toBe(true);
  });

  it("does not match markers inside other words", () => {
    const r = scoreListing({ ...client, positive_markers: ["pond"] }, { ...base, title: "Correspondence centre fit-out" }, undefined, now);
    expect(r.matched_positive).toEqual([]);
  });
});

describe("explainability", () => {
  it("component points add up to the score", () => {
    for (const title of ["Sitework and grading", "5-storey office tower", "Parking lot paving"]) {
      const r = scoreListing(client, { ...base, title }, undefined, now);
      const sum = Object.values(r.components!).reduce((s, c) => s + c.points, 0);
      expect(Math.abs(sum - r.fit_score!)).toBeLessThanOrEqual(1);
    }
  });
});

describe("board category tags", () => {
  it("do not rescue a listing whose own text is an interior renovation", () => {
    const r = scoreListing(client, { ...base, title: "Interior renovation Building 12", work_type_tags: ["excavation", "grading"] }, undefined, now);
    expect(r.deterministic_pass).toBe(false);
  });
  it("still count toward trade match", () => {
    const r = scoreListing(client, { ...base, title: "Reserve center project", work_type_tags: ["grading", "excavation"] }, undefined, now);
    expect(r.components!.trade.points).toBeGreaterThan(0);
  });
});
