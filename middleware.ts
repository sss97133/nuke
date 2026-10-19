/**
 * Vercel Edge Middleware for builds deployed from the repository root (the git integration's branch previews).
 * Production deploys from nuke_frontend/ (.github/workflows/deploy-vercel.yml), so the one implementation lives in
 * nuke_frontend/middleware.ts and this file re-exports it: previews and production run the same middleware.
 * Vercel reads `config` statically from this file, so the matcher is repeated here as a literal;
 * src/middlewareParity.test.ts fails when the two matchers differ.
 */
export { default } from './nuke_frontend/middleware';

export const config = {
  matcher: ['/', '/market', '/journal', '/llms.txt', '/vehicle/:path*', '/api/v1/vehicle/:path*',
    '/jobs', '/jobs/:path*', '/providers/:path*', '/org/:path*', '/sitemap-work.xml', '/login', '/work', '/work/setup'],
};
