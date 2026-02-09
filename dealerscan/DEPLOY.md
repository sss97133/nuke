# DealerScan – Deploy to production (e.g. dealerscan-three.vercel.app)

## 1. OAuth: don’t send logins to another site (n-zero)

**If Google sign-in sends you to n-zero**, the fix is in Supabase, not code. See **[AUTH_FIX.md](./AUTH_FIX.md)** for the exact steps.

Summary: Supabase Auth only redirects to your app if the URL is allowlisted. Otherwise it uses the project **Site URL** (n-zero).

- In **Supabase Dashboard** → **Authentication** → **URL Configuration**:
  - **Site URL**: set to `https://dealerscan-three.vercel.app` (or your DealerScan app URL).
  - **Redirect URLs**: add `https://dealerscan-three.vercel.app/**` (and any other DealerScan domains).

- Optionally in **Vercel** set `VITE_DEALERSCAN_APP_URL=https://dealerscan-three.vercel.app` so the app explicitly requests that redirect (the allowlist in Supabase is still required).

## 2. Images

Document images in the review UI are constrained to the viewing frame (no full-size layout). Thumbnails in the deal view use `object-contain` and lazy loading.

## 3. Payments and credits (“where did my $20 go?”)

Credits are added by a **Stripe webhook** when Stripe sends `checkout.session.completed`. If you paid but don’t see credits:

1. **Webhook must be configured in Stripe**
   - Stripe Dashboard → Developers → Webhooks → Add endpoint.
   - URL: `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`
   - Event: `checkout.session.completed`
   - Copy the **Signing secret** and set it in Supabase:
     - Project Settings → Edge Functions → Secrets: `STRIPE_WEBHOOK_SECRET=<signing_secret>`
   - Also set `STRIPE_SECRET_KEY` (and optionally `DEALERSCAN_URL`; see below).

2. **Same Stripe account**
   - The Stripe account that received the $20 payment must be the one with the webhook above. If you have test vs live, ensure the webhook is for the mode you paid in.

3. **Check webhook delivery**
   - Stripe Dashboard → Developers → Webhooks → your endpoint → see recent events and responses. Failed events show the error (e.g. 4xx/5xx or invalid signature).

4. **Supabase**
   - Edge function `stripe-webhook` must be deployed and have secrets `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
   - For DealerScan credit purchases the handler uses `metadata.purchase_type === 'dealerscan_credits'` and calls `ds_add_credits`.

After fixing the webhook, new purchases will add credits. For the existing $20 payment you can either:
- Manually add credits in the DB (e.g. via Supabase SQL or a one-off script calling `ds_add_credits`), or  
- Refund in Stripe and ask the user to purchase again once the webhook is working.

## 4. Vercel env (ship to public)

In the Vercel project for DealerScan (e.g. dealerscan-three):

| Variable | Required | Example |
|----------|----------|---------|
| `VITE_SUPABASE_URL` | Yes | `https://qkgaybvrernstplzjaam.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Yes | (anon key from Supabase) |
| `VITE_DEALERSCAN_APP_URL` | Yes for correct OAuth/Stripe return | `https://dealerscan-three.vercel.app` |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Optional (for future Stripe Elements) | (Stripe publishable key) |

Supabase Edge Functions (run in Supabase, not Vercel):

| Secret / env | Where | Purpose |
|--------------|--------|---------|
| `STRIPE_SECRET_KEY` | Supabase → Edge Functions → Secrets | Stripe API |
| `STRIPE_WEBHOOK_SECRET` | Same | Verify webhook signature |
| `DEALERSCAN_URL` | Same (optional) | Default success/cancel URL for `ds-create-checkout` when frontend doesn’t send URLs (e.g. `https://dealerscan-three.vercel.app`) |

Build: from repo root, build the web app (e.g. `npm run build` in `packages/web`). Vercel should use the root or `packages/web` according to your `vercel.json` (output directory `dist` for Vite).

## 5. Why your updates aren’t on the live site (and how to fix it)

Vercel builds from your **Git repo**. If you’ve pushed but the site still shows “Your Deals” / “Untitled Deal”:

1. **Confirm the project uses this repo**
   - Vercel Dashboard → your **dealerscan-three** project → **Settings** → **Git**.
   - **Connected Repository** must be the repo that has the `dealerscan` folder (e.g. `sss97133/nuke`). If it’s a different repo, connect this one or push the same code to that repo.

2. **Set Root Directory**
   - **Settings** → **General** → **Root Directory**: set to **`dealerscan`** (so Vercel uses `dealerscan/vercel.json` and builds `packages/web`). Leave blank only if the whole repo is the DealerScan app.

3. **Redeploy**
   - **Deployments** → open the latest deployment → **⋯** → **Redeploy** (or push an empty commit: `git commit --allow-empty -m "Trigger DealerScan deploy" && git push origin main`).

4. **Hard refresh**
   - After the new build is Live, do a hard refresh (Cmd+Shift+R) or open the site in an incognito window so the browser doesn’t serve old cached JS.

## 6. Deploy to Vercel (public)

1. Connect the repo (or `dealerscan` subfolder) to Vercel; use root `vercel.json` so build runs `cd packages/web && npm run build` and output is `packages/web/dist`.
2. Set environment variables in Vercel (see table above). **Important:** `VITE_DEALERSCAN_APP_URL=https://dealerscan-three.vercel.app` (or your production URL) so OAuth and payment return to your app.
3. Deploy. After deploy, complete the Supabase and Stripe steps above so login and payments work.

## 7. Quick checklist

- [ ] Supabase Redirect URLs include `https://dealerscan-three.vercel.app/**` (and Site URL set)
- [ ] Vercel env: `VITE_DEALERSCAN_APP_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- [ ] Stripe webhook added for `checkout.session.completed` → `stripe-webhook` URL
- [ ] Supabase secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- [ ] Redeploy after env changes so the app uses the correct redirect base

---

**Product:** Deal jacket pipeline (separate image set → packets → per-car repository, automated naming, paid service in n-zero): [docs/PRODUCT_DEAL_JACKET_PIPELINE.md](docs/PRODUCT_DEAL_JACKET_PIPELINE.md)
