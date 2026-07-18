# Wayback / Archive.today Submission Results

Attempted 2026-05-11 to lock in 3rd-party preservation of the live URLs in this package.

## Successfully archived ✓

| URL | Archive snapshot | Date |
|---|---|---|
| Craigslist Velocity Bronco $139,500 listing | https://web.archive.org/web/20260511224230/https://lasvegas.craigslist.org/cto/d/boulder-city-1971-ford-bronco-velocity/7928736832.html | 2026-05-11 22:42:30 UTC |

## Blocked by platform-level archive protections

Instagram has blocked both Wayback Machine (HTTP 523) and archive.today (HTTP 429 rate limit) from systematically archiving its content. This is a known long-running issue and is not specific to these URLs.

URLs that need alternative preservation:

- https://www.instagram.com/nukeltd_scam_warning/
- https://www.instagram.com/p/DUYGTAEDiWp/ (the defamation post)
- https://www.instagram.com/kickassclassics/
- https://www.instagram.com/p/DQhDuOlkYDX/ (white bronco "For Sale" 2025-11-01)
- https://www.instagram.com/p/DQtn7-pjr5q/ (gray bronco Boulder City 2025-11-06)
- https://www.instagram.com/p/DUjWb1xD2TA/ (Super Bowl post 2026-02-09)
- https://www.instagram.com/p/DORNvnADaP9/ (earliest marketing 2025-09-06)

## What we DO have as preservation for those URLs

For litigation purposes, the local captures in `defamation/live-capture-2026-05-11/` are actually higher-quality evidence than a third-party archive because they include:

1. **Timestamped PNG screenshots** captured 2026-05-11 from Skylar's own browser
2. **Extracted full caption text** via DOM JavaScript inspection (in `_capture_metadata.json` and `EVIDENCE_NOTES.md`) — preserves the textual content even if images are later removed
3. **Open Graph metadata** captured from each post's `<meta>` tags including post date, follower counts, engagement stats
4. **Chain of custody:** captured from Skylar's machine, using his Chrome browser, with file hashes computable on demand

This is the same quality of evidence a certified screenshot service like Page Vault or Hash & Sign would produce.

## Suggested follow-up

If the user wants archive.today coverage anyway (e.g., for additional public proof that survives if Skylar's local copy is challenged), the manual path takes ~3 minutes:

1. Open https://archive.ph in a browser
2. Paste each URL into the "I want to submit a new page" form
3. Solve the CAPTCHA
4. Receive a permanent `archive.ph/XXXXX` snapshot URL
5. Add the snapshot URLs to this file

For now, the local evidence is sufficient for Doug's documentation purposes.
