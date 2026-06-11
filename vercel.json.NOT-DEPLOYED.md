# ⚠️ This file is NOT deployed. Do not "fix" routing here.

This was the repo-root `vercel.json`. **Vercel never reads it.**

Both deploy workflows run `vercel deploy` with `working-directory: ./nuke_frontend`
(see `.github/workflows/deploy-vercel.yml` and `.github/workflows/deploy-preview.yml`),
so the only routing config that reaches production is:

```
nuke_frontend/vercel.json   ← edit THIS one
```

Same goes for serverless functions: only `nuke_frontend/api/**` is uploaded.
Files under repo-root `api/` are dead code.

## Why this tombstone exists

Routing fixes repeatedly landed in this file and shipped nothing:

- `f07181e05` — case study: routing fix landed here, prod unchanged.
- `4342ca036` — "Fix /v1/events + /api/docs routing" landed here; both stayed
  broken in prod until they were re-done in `nuke_frontend/vercel.json`.
- PR #273 — evidence chain proving the deploy path (`/api/journal/:date` fix).

If you are reading this because you grepped for `vercel.json`: the file you
want is `nuke_frontend/vercel.json`.

## Last contents before retirement (2026-06-10, for reference only)

Rewrites that mattered were folded into `nuke_frontend/vercel.json`
(`/v1/events`, `/api/docs`). `/api/functions/v1/:path*` is owned by PR #227.
The CSP header block below was never live; fold it in deliberately (and test)
if you want it, don't copy it blind.

```json
{
  "buildCommand": "cd nuke_frontend && CI=false npm run build",
  "outputDirectory": "nuke_frontend/dist",
  "installCommand": "cd nuke_frontend && npm install",
  "framework": "vite",
  "rewrites": [
    {
      "source": "/mcp/:path*",
      "destination": "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/mcp-connector/:path*"
    },
    {
      "source": "/mcp",
      "destination": "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/mcp-connector"
    },
    {
      "source": "/api/mcp",
      "destination": "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/mcp-connector"
    },
    {
      "source": "/v1/events",
      "destination": "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/api-v1-events"
    },
    {
      "source": "/v1/events/:path*",
      "destination": "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/api-v1-events/:path*"
    },
    {
      "source": "/.well-known/oauth-authorization-server",
      "destination": "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/oauth-server/.well-known/oauth-authorization-server"
    },
    {
      "source": "/.well-known/oauth-protected-resource",
      "destination": "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/oauth-server/.well-known/oauth-protected-resource"
    },
    {
      "source": "/oauth/:path*",
      "destination": "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/oauth-server/oauth/:path*"
    },
    {
      "source": "/api/functions/v1/:path*",
      "destination": "https://qkgaybvrernstplzjaam.functions.supabase.co/:path*"
    },
    {
      "source": "/api/v1/vehicle/:path*",
      "destination": "/api/v1/vehicle/:path*"
    },
    {
      "source": "/api/docs",
      "destination": "/api/docs"
    },
    {
      "source": "/api/journal",
      "destination": "/api/journal"
    },
    {
      "source": "/api/journal/:date",
      "destination": "/api/journal/:date"
    },
    {
      "source": "/api/:path+",
      "destination": "https://qkgaybvrernstplzjaam.functions.supabase.co/mailbox/:path+"
    },
    {
      "source": "/data/:path+",
      "destination": "/data/:path+"
    },
    {
      "source": "/:path*",
      "destination": "/index.html"
    }
  ],
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    },
    {
      "source": "/index.html",
      "headers": [
        { "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }
      ]
    },
    {
      "source": "/((?!assets/).*)",
      "headers": [
        { "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }
      ]
    },
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-XSS-Protection", "value": "1; mode=block" },
        { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://unpkg.com https://cdn.redoc.ly https://js.stripe.com; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.redoc.ly https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https: blob:; connect-src 'self' https://*.supabase.co https://*.supabase.in wss://*.supabase.co wss://*.supabase.in https://qkgaybvrernstplzjaam.functions.supabase.co https://api.stripe.com; frame-src 'self' https://js.stripe.com https://hooks.stripe.com; object-src 'none'; base-uri 'self'; form-action 'self'" }
      ]
    }
  ]
}
```
