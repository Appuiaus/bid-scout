import { describe, expect, it } from "vitest";
import { mapNotice } from "../src/adapters/samgov";
import { stateFromText, stateFromZip } from "../src/adapters/usstate";

// Shapes taken from real SAM.gov notices (Oct 2026) that had no structured state.
describe("state inference", () => {
  it("from ZIP", () => {
    expect(stateFromZip("16647")).toBe("PA");
    expect(stateFromZip("35898")).toBe("AL");
    expect(stateFromZip("42141")).toBe("KY");
    expect(stateFromZip("75201-1234")).toBe("TX");
    expect(stateFromZip("")).toBeNull();
  });
  it("from address and title", () => {
    expect(stateFromText("Barren River Lake11088 Finney RdGlasgow, KY 42141")).toBe("KY");
    expect(stateFromText("Raystown Lake Project in Huntingdon County, Pennsylvania")).toBe("PA");
    expect(stateFromText("F--MI-SENEY NWR-HAZARDOUS FUELS REDUCTION")).toBe("MI");
    expect(stateFromText("Bridge repair, West Virginia")).toBe("WV");
    expect(stateFromText("ACC002 Utilities and Infrastructure")).toBeNull();
  });
  it("never uses the contracting office", () => {
    const l = mapNotice({
      noticeId: "x", title: "ACC002 Utilities and Infrastructure", type: "Solicitation",
      placeOfPerformance: { streetAddress: "", zip: "" },
      // @ts-expect-error officeAddress is deliberately not part of the mapped type
      officeAddress: { city: "ANCHORAGE", state: "AK" },
    })!;
    expect(l.state).toBeNull();
  });
});
