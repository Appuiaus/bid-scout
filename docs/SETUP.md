# Setup: Cloudflare (free plan)

Everything below is **new and separate**. Nothing touches Ben's existing domain, DNS records or tunnels.

## Already done
- ✅ D1 database **`bid-scout-db`** (id `a38b7aed-16f8-4c88-96a4-e18b3634141e`, US East), with the schema from `migrations/0001_initial.sql` applied.

## Ben: step 1, deploy the Worker (about 5 min, one time)
Pick one of these.

**A. Auto-deploy from GitHub (recommended).** Every push to the branch then deploys itself.
1. In the Cloudflare dashboard, go to **Workers & Pages → Create → Import a repository**.
2. Connect GitHub and choose this repo. Set the branch to `claude/sweet-fermi-9w6nv9` (or `main` once that exists).
3. Leave the build command empty. Set the deploy command to `npx wrangler deploy`.
4. Click **Deploy**. You'll get `https://bid-scout.<your-subdomain>.workers.dev`.

**B. From your own computer:** `npm install && npx wrangler login && npx wrangler deploy`

At this point the page shows *"Cloudflare Access is not configured yet"*. That's expected: the hub fails closed.

## Ben: step 2, turn on the login (Cloudflare Access, free)
1. Go to **Workers & Pages → bid-scout → Settings → Domains & Routes**. On the `workers.dev` row, choose **Enable Cloudflare Access**. If Zero Trust asks you to pick a team name and the Free plan, do that; it's free for small teams.
2. Open **Manage Cloudflare Access** (or go to Zero Trust → Access → Applications → bid-scout). Edit the policy so it **allows these emails only**: Ben, Pedro, and the boss if wanted. Login method: One-time PIN (code by email).
3. Copy two values and send them to Claude in chat. **They are not secret.**
   - **Team domain**: the `<team>` part of `<team>.cloudflareaccess.com` (Zero Trust → Settings → Custom pages / Team domain)
   - **Application Audience (AUD) tag**: on the Access application's overview page
4. Claude adds them to `wrangler.jsonc` and pushes. If you used option A, it redeploys on its own. Then open the URL, enter your email, get the code, and you're in.

## Free plan limits to watch
| Limit | Free | When it would bite |
|---|---|---|
| CPU per scheduled run | 10 ms | Big batches of listings. Fix: smaller batches, or $5/mo Workers Paid |
| Outbound calls per run | 50 | Many boards or pages per run |
| Cron triggers per account | 5 | More than five board schedules |
| D1 rows written per day | 100,000 | Not expected |

Review these if errors show up in the hub's "Recent board runs" list.
