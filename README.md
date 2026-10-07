# Bid opportunity finder (working name)

An automated bid-board search assistant for a small business that supports US earthworks and excavation contractors.

It searches construction bid boards for projects that suit each client, filters and scores them in a way you can check, and puts them in a queue where Ben approves or rejects each one. Approved items go to the boss's internal AI tool. **Nothing is submitted or sent without a human approving it.**

- [`docs/BRIEF.md`](docs/BRIEF.md): the working brief, with notes on what is and isn't feasible
- [`docs/DECISIONS.md`](docs/DECISIONS.md): open questions and decisions waiting for Ben and Pedro

- [`docs/SETUP.md`](docs/SETUP.md): Cloudflare setup steps (free plan)

Status: **Phase 0 → 1.** D1 database created. The read-only hub and scoring engine are built and tested, waiting for Ben to deploy them and turn on Access.

```
npm install
npm test          # scoring rules vs Ben's yes/no examples
npm run dev       # local hub (returns 503 until Access vars are set)
```
