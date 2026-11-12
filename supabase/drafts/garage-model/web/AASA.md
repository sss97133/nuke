# DRAFT — apple-app-site-association for nuke.ag (not applied; no deploy config changed)

Purpose: make `https://nuke.ag/join/<token>` open the Nuke Capture app (bundle `ag.nuke.capture`) instead of Safari.
The app side (`applinks:nuke.ag` entitlement in `apps/nuke-capture-ios/project.yml`) is in the same branch.

## What must exist on nuke.ag (repo-only: read from the repo 2026-11-12, not probed live; this swarm may not fetch nuke.ag)

* The frontend is a Vite SPA on Vercel. Both `vercel.json` (repo root) and `nuke_frontend/vercel.json` rewrite `/:path*` to
  `/index.html`. Vercel serves files from the build output (`nuke_frontend/public/` becomes `dist/`) before rewrites, so a file at
  `nuke_frontend/public/.well-known/apple-app-site-association` is served as-is. `nuke_frontend/public/.well-known/` exists today
  and holds only `mcp.json`. Which of the two `vercel.json` files the project really deploys is a known trap
  (`.claude/rules/production-engineering.md`, "MCP could not attach"): check the live response, not the file.
* Apple requires HTTPS, **no redirect**, status 200, `Content-Type: application/json`, a file name with no extension, at
  `/.well-known/apple-app-site-association`.
* Vercel serves an extensionless file as `application/octet-stream` unless a header rule sets the type. Add to the `headers`
  array of the DEPLOYED `vercel.json`:

```json
{
  "source": "/.well-known/apple-app-site-association",
  "headers": [
    { "key": "Content-Type", "value": "application/json" }
  ]
}
```
* `TEAMID` in `apple-app-site-association` is a placeholder: the 10-character Apple Team ID is not pinned in the repo
  (`project.yml` leaves `DEVELOPMENT_TEAM` unset on purpose). Skylar replaces it from the Apple Developer Membership page.
* The `X-Frame-Options`, CSP and `no-store` rules in the catch-all header block do not break the AASA fetch.

## Web fallback for people without the app

`/join/:token` has no route today. `nuke_frontend/src/routes/DomainRoutes.tsx` has `/invite/:token` and `/supplier-invite/:token`,
both `SupplierInvitePage`: those are supplier invites and are not reused. Without a route the SPA shows its not-found view.
Wanted: a `/join/:token` page that calls `functions/garage-join` (GET `?token=`), shows "<garage> invites you as a <role>" or the
reason, and links to the App Store. That is frontend work, outside this draft, and goes through a PR to `main`.
The CSP `connect-src` already allows `https://qkgaybvrernstplzjaam.functions.supabase.co`, which is where it would call.

## Verification once deployed (needs a Mac or device)

1. `curl -sSI https://nuke.ag/.well-known/apple-app-site-association`: `200`, `content-type: application/json`, no `location:`.
2. `https://app-site-association.cdn-apple.com/a/v1/nuke.ag` returns the same JSON (Apple's CDN copy; can lag).
3. Tap `https://nuke.ag/join/<43-char token>` in Notes or Messages on a device with the build installed: the app opens on the Join screen.
