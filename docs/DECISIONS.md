# Decisions and questions for Ben and Pedro

Answer inline or in chat. ☐ = open, ☑ = decided.

## A. Housekeeping
- ☐ **Q1. Repo name.** I can't rename the repo from this session because the GitHub tools here don't support it. Rename it in GitHub → Settings → General → Repository name. Suggestions: `sitework-bid-finder`, `bid-scout`, `earthworks-bid-scout`, `bidboard-hub`. GitHub redirects the old URL automatically.

## B. Hosting
- ☑ **Q2. Where does the hub run?** **Decided 2026-10-07: Cloudflare Workers + D1 + Access, free plan. Review if limits bite.** Original options: (a) Cloudflare Workers + D1 + Access, serverless with nothing to keep switched on *(recommended)*, or (b) a machine Ben owns, exposed through a new dedicated Cloudflare Tunnel. If (b), which machine?
- ☑ **Q3. Hostname.** **Using `*.workers.dev` for now (free, doesn't touch the existing domain). A subdomain can be added later.** Original options: (a) a `*.workers.dev` address, which doesn't touch Ben's domain at all, or (b) a new subdomain on Ben's domain, which adds one new DNS record and changes nothing existing. If (b), which subdomain?
- ☐ **Q4. Who clicks the Cloudflare setup buttons?** Ben, following step-by-step instructions I write, or Ben creates a **scoped API token** (Workers, D1 and Access on this one account only) for the build.
- ☐ **Q5. Login to the hub.** Cloudflare Access with a one-time PIN sent to an allowlist of emails (Ben, Pedro, the boss?), or Google login. Who is on the allowlist?

## C. Boards
- ☐ **Q6. The full board list.** The five main boards (BuildingConnected and PlanHub, plus which three others?) and every niche board, each with its URL, **who owns the account** (Ben, the boss or the client), whether it uses 2FA (SMS, app or email) and whether it sends email alerts.
- ☐ **Q7. BuildingConnected.** Do any of the accounts have **Bid Board Pro**? The API only shows invitations *to that account*, so which account receives the invites that matter: the business's or each client's? Will the boss ask the Autodesk account manager to enable API access?
- ☐ **Q8. PlanHub API.** Is it worth asking for a quote? (It's an annual enterprise licence.)
- ☐ **Q9. Public procurement portals.** May we use SAM.gov (free official API) and state DOT and county portals as a sanctioned source, and possibly as the Phase 1 board?
- ☐ **Q10. Boards with no API.** Default rule: no automated logged-in access. Use email alerts or Ben's CSV exports instead, and decide case by case after reading each board's terms. Agree?

## D. Clients and scoring
- ☐ **Q11. v1 scope.** Earthworks clients only, leaving out the one or two different ones? Which client is the **Phase 1 pilot**?
- ☐ **Q12. Client parameters.** Can we get a read-only export of the per-client profiles from the internal tool, or should we start from the shared Google Sheet? (Please share its link with read-only access.)
- ☐ **Q13. Calibration set.** Five to ten recent listings Ben said yes to and five to ten he said no to, each with one line of reasoning.
- ☐ **Q14. Unvalued, file-less listings.** Show them in the queue with a "low confidence" badge (recommended), or hide them for some clients?

## E. Integration and schedule
- ☐ **Q15. Boss's tool entry point.** How does an approved opportunity get into it today: a form, an email to an address, a Drive file or Sheet, or a click in the app? Can the cousin's team give us a supported way to drop items in without changing their tool?
- ☐ **Q16. Meeting schedule.** Each client's meeting day and time, plus their US city or timezone. Also confirm where Ben works from (Brisbane?), because the "10 hours behind" figure doesn't match US timezones (the real gap is 14–18 hours).
- ☐ **Q17. Bids email.** Is it Google Workspace or regular Gmail? Is there an estimated date? Would a read-only OAuth grant be acceptable instead of an app password?
- ☐ **Q18. AI reasoning (Phase 2).** Who holds the Anthropic API key and billing, and what's the monthly budget cap?

## F. Data ownership
- ☐ **Q19.** Confirm that the client lists and opportunity data belong to the business, and say who should have admin access to the hub and its data (Ben only, or the boss as well?).
