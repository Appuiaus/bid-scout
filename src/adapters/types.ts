import type { Listing } from "../scoring";

// What every board adapter returns. Adapters only READ from their source.
export interface NormalizedListing extends Listing {
  source_reference: string; // stable id on the board
  city: string | null;
  url: string | null;
  raw: unknown;             // original record, stored for audit
}

export interface BoardRow {
  board_id: string;
  board_name: string;
  access_type: string;
  endpoint: string | null;
  search_parameter_mapping: string; // JSON
  enabled: number;
}

export interface AdapterContext {
  board: BoardRow;
  params: Record<string, unknown>;
  secrets: Record<string, string | undefined>;
  now: Date;
  fetch: typeof fetch;
}

export interface Adapter {
  fetchListings(ctx: AdapterContext): Promise<{ listings: NormalizedListing[]; calls: number }>;
}
