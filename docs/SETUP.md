# Setup: Cloudflare (free plan)

Everything below is **new and separate**. Nothing touches Ben's existing domain, DNS records or tunnels.

## Already done
- ✅ D1 database **`bid-scout-db`** (id `a38b7aed-16f8-4c88-96a4-e18b3634141e`, US East), with the schema from `migrations/0001_initial.sql` applied.

## Ben: step 0, get a free SAM.gov API key (Phase 1 source)
1. Sign in at **sam.gov** (it uses a Login.gov account; create one if needed). Use a business email, not a personal one, if possible.
2. Go to **Profile → Account Details → Public API Key → Request API Key**. Copy the key.
3. Don't paste it into chat or email. Store it as a Worker **secret** after step 1: **Workers & Pages → bid-scout → Settings → Variables and Secrets → Add → type *Secret*, name `SAM_API_KEY`**.
4. Quota: a key with no SAM "role" gets **10 calls/day**. Each daily run uses 5 (one per work-type code). Keys expire every 90 days; SAM.gov emails a reminder.

## Ben: step 1, deploy the Worker (about 5 min, one time)
Pick one of these.

**A. Auto-deploy from GitHub (recommended).** Every push to the branch then deploys itself.
1. In the Cloudflare dashboard, go to **Workers & Pages → Create → Import a repository**.
2. Connect GitHub and choose **Appuiaus/bid-scout**. Set the branch to `claude/sweet-fermi-9w6nv9` (or `main` once that exists).
3. Leave the build command empty. Set the deploy command to `npx wrangler deploy`.
4. Click **Deploy**. You'll get `https://bid-scout.<your-subdomain>.workers.dev`.

**B. From your own computer:** `npm install && npx wrangler login && npx wrangler deploy`

At this point the page shows *"Cloudflare Access is not configured yet"*. That's expected: the hub fails closed.

## Ben: step 2, turn on the login (Cloudflare Access, free)
1. Go to **Workers & Pages → bid-scout → Settings → Domains & Routes**. On the `workers.dev` row, choose **Enable Cloudflare Access**. If Zero Trust asks you to pick a team name and the Free plan, do that; it's free for small teams.
2. Open **Manage Cloudflare Access** (or go to Zero Trust → Access → Applications → bid-scout). Edit the policy so it **allows these emails only**: Ben, Pedro, and the boss if wanted. Login method: One-time PIN (code by email).
3. Copy two values. **They are not secret.**
   - **Team domain**: the `<team>` part of `<team>.cloudflareaccess.com` (Zero Trust → Settings → Custom pages / Team domain)
   - **Application Audience (AUD) tag**: on the Access application's overview page
4. Add both as **plain-text variables**: **Workers & Pages → bid-scout → Settings → Variables and Secrets → Add**, named `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`, then **Deploy**. Deploys from GitHub keep them (`keep_vars`). Open the URL, enter your email, get the code, and you're in.

## What happens after setup
- Every day at **12:00 UTC** (8am US Eastern, 10pm Brisbane), the Worker searches SAM.gov for the last 3 days of notices under site prep (238910), highway/street (237310), water/sewer line (237110), other heavy civil (237990) and commercial building (236220, kept only when the listing itself shows earthwork). It scores them for each client whose `boards_to_search` includes `samgov`.
- The hub's home page lists every run. A failed run (bad key, quota used up) shows in red there and doesn't affect anything else.

## Free plan limits to watch
| Limit | Free | When it would bite |
|---|---|---|
| CPU per scheduled run | 10 ms | Big batches of listings. Fix: smaller batches, or $5/mo Workers Paid |
| Outbound calls per run | 50 | Many boards or pages per run |
| Cron triggers per account | 5 | More than five board schedules |
| D1 rows written per day | 100,000 | Not expected |

Review these if errors show up in the hub's "Recent board runs" list.
