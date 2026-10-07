import { describe, expect, it } from "vitest";
import { mapNotice, samgov } from "../src/adapters/samgov";
import { dedupeKey } from "../src/ingest";

const notice = {
  noticeId: "abc123",
  title: "Sitework and Grading for New Reserve Center",
  solicitationNumber: "W912BV-26-B-0001",
  type: "Solicitation",
  postedDate: "2026-10-05",
  responseDeadLine: "2026-10-30T14:00:00-05:00",
  naicsCode: "238910",
  active: "Yes",
  award: null,
  placeOfPerformance: { city: { name: "Fort Worth" }, state: { code: "TX" } },
  uiLink: "https://sam.gov/opp/abc123/view",
  resourceLinks: ["https://sam.gov/api/prod/opps/v3/opportunities/resources/files/x/download"],
  fullParentPathName: "DEPT OF DEFENSE.DEPT OF THE ARMY.USACE",
};

describe("SAM.gov mapping", () => {
  it("maps a solicitation into a listing", () => {
    const l = mapNotice(notice)!;
    expect(l.state).toBe("TX");
    expect(l.city).toBe("Fort Worth");
    expect(l.files_present).toBe(true);
    expect(l.project_value).toBeNull();
    expect(l.work_type_tags).toContain("grading");
    expect(l.bid_due_at).toBe("2026-10-30T19:00:00.000Z");
  });

  it("skips award notices and inactive notices", () => {
    expect(mapNotice({ ...notice, type: "Award Notice" })).toBeNull();
    expect(mapNotice({ ...notice, active: "No" })).toBeNull();
  });

  it("makes one call per NAICS code and stops loudly on quota exhaustion", async () => {
    const urls: string[] = [];
    const fakeFetch = (async (u: string) => {
      urls.push(u);
      return new Response(JSON.stringify({ opportunitiesData: [notice] }), { status: 200 });
    }) as unknown as typeof fetch;
    const board = { board_id: "samgov", board_name: "SAM", access_type: "api", endpoint: null, search_parameter_mapping: "{}", enabled: 1 };
    const res = await samgov.fetchListings({
      board, params: { naics: ["238910", "237310"] }, secrets: { SAM_API_KEY: "k" },
      now: new Date("2026-10-07T12:00:00Z"), fetch: fakeFetch,
    });
    expect(res.calls).toBe(2);
    expect(urls[0]).toContain("postedFrom=10%2F04%2F2026");
    expect(urls[0]).toContain("ncode=238910");

    const quota = (async () => new Response("", { status: 429 })) as unknown as typeof fetch;
    await expect(samgov.fetchListings({ board, params: {}, secrets: { SAM_API_KEY: "k" }, now: new Date(), fetch: quota }))
      .rejects.toThrow(/quota/);
  });

  it("requires the API key", async () => {
    const board = { board_id: "samgov", board_name: "SAM", access_type: "api", endpoint: null, search_parameter_mapping: "{}", enabled: 1 };
    await expect(samgov.fetchListings({ board, params: {}, secrets: {}, now: new Date(), fetch })).rejects.toThrow(/SAM_API_KEY/);
  });

  it("dedupe key ignores punctuation and case", () => {
    expect(dedupeKey({ title: "Sitework & Grading — Phase 2", state: "tx" }))
      .toBe(dedupeKey({ title: "SITEWORK GRADING PHASE 2", state: "TX" }));
  });
});

describe("NAICS 236220 (commercial building)", () => {
  const client = {
    client_id: "c", work_types: ["grading", "excavation"], states: ["TX"], base_lat: null, base_lng: null,
    radius_miles: null, value_min: null, value_max: null, include_unvalued_listings: true,
    positive_markers: ["sitework"], negative_markers: ["interior renovation"],
  };
  const n236 = { ...notice, naicsCode: "236220", responseDeadLine: "2099-01-01T00:00:00Z" };

  it("is in the default search set", async () => {
    const urls: string[] = [];
    const f = (async (u: string) => { urls.push(u); return new Response('{"opportunitiesData":[]}'); }) as unknown as typeof fetch;
    const board = { board_id: "samgov", board_name: "SAM", access_type: "api", endpoint: null, search_parameter_mapping: "{}", enabled: 1 };
    await samgov.fetchListings({ board, params: {}, secrets: { SAM_API_KEY: "k" }, now: new Date(), fetch: f });
    expect(urls.length).toBe(5);
    expect(urls.some((u) => u.includes("ncode=236220"))).toBe(true);
  });

  it("vertical-only building stays below the surface threshold", async () => {
    const { scoreListing } = await import("../src/scoring");
    const l = mapNotice({ ...n236, title: "Construct New Administration Building" })!;
    expect(l.work_type_tags).toEqual([]);
    expect(scoreListing(client, l).fit_score!).toBeLessThanOrEqual(35);
  });

  it("building with sitework in its own text still scores well", async () => {
    const { scoreListing } = await import("../src/scoring");
    const l = mapNotice({ ...n236, title: "New Reserve Center including sitework and grading" })!;
    expect(scoreListing(client, l).fit_score!).toBeGreaterThanOrEqual(70);
  });
});
