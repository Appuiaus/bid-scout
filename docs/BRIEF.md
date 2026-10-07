# Working brief (Phase 0)

This is the original brief, adjusted after checking what is technically and contractually realistic. Where this document and the original prompt disagree, this document wins. Each change is marked **[ADJUSTED]**.

## 1. People and scope
- **Ben**: finds bids. He searches boards, qualifies listings and passes them to his boss.
- **Boss (Ben's cousin, Canada)**: re-qualifies each listing, rings the client and helps with the bid.
- **Pedro**: senior solution architect, co-building this system.
- **Clients**: US earthworks and excavation contractors (grading, cut and fill, foundation and over excavation, site utilities, paving, asphalt).
- **v1 scope**: earthworks clients only (to be confirmed: see DECISIONS Q8).
- **Out of scope**: the internal AI tool itself (we only feed it) and "kango", the ops and training package.

## 2. What is and isn't feasible: adjustments to the original brief

### 2.1 Hosting: Cloudflare Tunnel vs Workers **[ADJUSTED]**
A Cloudflare Tunnel only makes sense when the app runs on a machine you keep on (a PC, a NAS or a VPS) and `cloudflared` exposes it. The brief doesn't name any such machine.

**Recommended instead:** run the hub on **Cloudflare Workers + D1 (database) + Cron Triggers (scheduler)**, protected by **Cloudflare Access** (free for up to 50 users, with one-time-PIN or Google login). This needs no server to keep running and no tunnel. It fits the "isolated, additive" rule: a new Worker, a new D1 database and a new Access application, with no changes to existing tunnels.

Choosing a hostname affects how isolated the setup is:
- `*.workers.dev` hostname: **does not touch Ben's existing domain at all.** Cloudflare Access can still protect it.
- New subdomain on Ben's existing domain (e.g. `bids.example.com`): adds **one new DNS record** to the existing zone. Nothing existing is changed, but it is technically inside that zone.

If Ben does want a tunnel (for example, the hub has to run on a particular machine), it will be a **new, separately named tunnel** with its own hostname, and no existing tunnel will be edited.

**Limitation:** this session can't create tunnels or Access applications on Ben's account. The available Cloudflare tooling covers only Workers, D1, KV and R2, and changing account security settings needs Ben's own approval. Ben will either click through those steps himself (with written instructions) or grant a scoped API token.

### 2.2 BuildingConnected API **[ADJUSTED]**
- BuildingConnected's Bid Board API (through Autodesk Platform Services) exposes **the opportunities that the account has been invited to bid on**, not a search of the whole marketplace. It is a subcontractor's inbox of invitations.
- So the API only helps if the account is the **client's** (they receive the invites) or if the business receives invites on its own account. A search across the open "BuildingConnected marketplace" is not part of that API.
- It needs a **Bid Board Pro** subscription, API access enabled by the Autodesk account manager, and an APS app registration (OAuth, using 3-legged auth for the account holder). Webhooks need a public HTTPS endpoint, which a Worker provides.
- The **client** would have to authorise access to their own account. That is a conversation for the boss to have with the client.

### 2.3 PlanHub API **[ADJUSTED]**
PlanHub's Project API is an **enterprise data licence**: quoted annually, priced by region and volume. For a small business it may cost more than it saves. Get a quote before planning around it. It may fit Phase 3 rather than Phase 1.

### 2.4 Boards without an API **[UNCHANGED, reinforced]**
For these we will **not** build any logged-in scraping or session replay without a written decision from Ben and Pedro, made per board after reading that board's terms of use. Legal options in order of preference:
1. Ask the board for an official feed, partner access or export.
2. **Email alerts** (most boards offer them). This is the low-risk, sanctioned route once the bids inbox is available.
3. Saved-search CSV or export files downloaded by Ben and uploaded to the hub. This is semi-manual, but still removes most of the scanning.
4. Automated logged-in fetching only after a recorded per-board decision. It must stay isolated, fail loudly and have session health checks.

**Public government procurement portals** (SAM.gov, which has an official free API, plus state DOT and county bid portals) are a sanctioned, free source of grading, roadwork and site utility jobs. These could be the **Phase 1 board** if no commercial API is available yet.

### 2.5 Email ingestion **[ADJUSTED]**
Google is phasing out app passwords and IMAP for many Workspace accounts, and Workers can't easily run IMAP. When the bids inbox becomes available, the preferred route is the **Gmail API with a read-only OAuth scope** (`gmail.readonly`, filtered to alert labels). The fallback is an app password over IMAP, and only if the account allows it. The adapter stays disabled until access is granted.

### 2.6 Secrets **[ADJUSTED, more specific]**
Secrets go in **Cloudflare Workers Secrets / Secrets Store**, never in D1. D1 stores only a `secret_reference` name. Credentials are entered through an Access-protected form on the hub, never by email or chat.

### 2.7 Timezones **[ADJUSTED]**
The brief says the clients are "about ten hours behind Brisbane". The actual gap is 14–15 hours for US Eastern and 17–18 hours for US Pacific, depending on daylight saving. The team is also described as being in Canada. To avoid that kind of confusion, the system stores an **IANA timezone for each client** (e.g. `America/Chicago`) and one for Ben, and does all the conversion in code. No offsets are hardcoded.

### 2.8 Write-back to the boss's tool **[OPEN]**
The internal tool reads Gmail and Drive. The least intrusive write-back, which needs no changes to that tool, is to **drop approved items where it already looks**: a dedicated Drive folder or Sheet, or an email to an address it watches. We will confirm the real entry point with the cousin's team before Phase 4.

### 2.9 AI reasoning cost **[UNCHANGED]**
Phase 2 uses the Claude API, and only for the shortlist the deterministic filter lets through. It needs an Anthropic API key (with separate billing). Usage is logged for each call.

## 3. Architecture (as adjusted)

```
 Board APIs / webhooks / (later) Gmail alerts / CSV upload
                │
        [Ingestion adapters]  one per board, isolated, each fails on its own
                │
        [Normaliser]  → opportunity records (D1)
                │
        [Stage 1: deterministic pre-filter]  location, trade, value, +/- markers
                │
        [Stage 2: explainable fit score 0–100 + confidence flag]
                │
        [Stage 3 (Phase 2): AI reasoning on shortlist only]
                │
        [Hub queue]  Ben approves / rejects  ──► decision log (tuning)
                │ approved only, human-triggered
        [Write-back (Phase 4)]  → boss's tool entry point, logged, reversible
```
Scheduler: Cron Triggers, US business hours only, with a refresh before each meeting.

## 4. Data model
As set out in the original brief (client profile, opportunity, decision log, credential record, board adapter config). Additions:
- `client.timezone` and `ben.timezone` are IANA strings.
- `opportunity.dedupe_key`: the same project often appears on several boards.
- `opportunity.raw_payload_ref`: the original data, kept for audit.
- `writeback_log`: opportunity_id, target, payload, written_at, written_by, reversed_at.

## 5. Scoring (Phase 1)
Stage 1 drops a listing on any of these hard fails: outside the service area, outside the value bracket (unless the value is missing and `include_unvalued_listings` is set), or a negative marker with no positive marker.

Stage 2 sums weighted components, and every component is stored and shown:

| Component | Weight (start) | Notes |
|---|---|---|
| Location match | 25 | inside service area or radius; scales down with distance |
| Trade match | 25 | overlap of work-type tags |
| Marker strength | 20 | "sitework" is strong; grading, earthwork, excavation, paving add more |
| Value fit | 15 | position within the client's bracket; missing value scores neutral, not zero |
| Recency / due date | 10 | enough time left to bid |
| Data completeness | 5 | has a value, files and a scope description |

`confidence_flag = low` when there is no value **and** no files. These listings are **shown** with a badge, not buried. The weights and the surface threshold live in the rules store and can be edited in the hub.

## 6. Phases (as adjusted)
- **Phase 0**: decisions (DECISIONS.md), hosting set up, board inventory, client parameters.
- **Phase 1**: one client, one board, read-only. The board is the best sanctioned source available now: BuildingConnected API if the account allows it, otherwise SAM.gov or a state portal, otherwise CSV upload. The hub shows scored listings with a component breakdown. No writing to anything.
- **Phase 2**: AI reasoning, the approve/reject queue and the decision log.
- **Phase 3**: more boards, the credential store and health checks. Email adapter built but left disabled.
- **Phase 4**: write-back through the confirmed entry point, meeting-aware scheduling, and the email adapter if access has arrived.
- **Phase 5**: supervised autonomy trial.

## 7. Non-negotiables
- No outbound action (board submission, client message, write-back) without Ben's explicit click.
- Ben's existing Cloudflare domain, tunnels and DNS are not modified.
- No automated logged-in access to any board without a recorded per-board decision.
- Business data stays inside this system and the agreed accounts.
