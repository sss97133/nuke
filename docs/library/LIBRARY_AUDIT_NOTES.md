# Library audit notes (working log, 2026-11-23 PST)

Status: the drafts aren't applied, and nothing has been written to the DB.

## 1. Privacy: why some photos were blacked out and others weren't
Client side (iOS Library):
- **No verdict meant the photo showed.** The grid painted pixels before, or without, any classification.
- **The face-detector failure path returned "not personal".** It used `try?` → false, so any Vision error counted as safe.
- **Album cells never classified.** Only the main grid called the classifier.
- **The grid's "personal" check was face-only.** Sensitive documents (IDs, titles) were only junk-blurred, never blacked out.
- **The full-screen pager ignored every verdict.**
- **Server privacy flags were never read.**

Numbers for the owner's account (30,350 rows):
- 627 `is_sensitive`, all with public bucket URLs.
- 1,255 `rejected_personal`.
- 370 documents.
- 1,450 server-blocked in total, of which 579 map to a phone photo. For those 579, the phone's synced verdict calls only 3 personal; 101 are marked "show" and 475 were never synced.
- 190 photos the phone calls personal aren't flagged on the server.

Server leaks:
- **245 private photos are readable by other org members.** The org-member SELECT policy has no privacy filter.
- **13 non-sensitive documents are readable by anon** on public vehicles.

Fix: #3741 makes the Library fail closed. Server-flagged, unchecked and failed reads are covered with no pixels drawn, on every surface and in the pager.

Server drafts are in `supabase/drafts/library-privacy/` (not applied).

## 2. Cohort coverage (owner's 29,500 photos)
| Link | Coverage |
|---|---|
| Vehicle | 53.9% |
| Make/model, through the vehicle | 53.8% |
| Org | 52.5% |
| GPS | 83.1% |
| ZCTA cell | 76.2% |
| Named place | 0 |
| Work session | 45.7% |
| Image set | 34% |
| Keys | 46% |
| Data-set membership | 6 photos |

Whole DB (about 65M rows, 99.1% external), from a sample:
- vehicle 99.9%;
- org 71.5%;
- GPS about 0%.

`vehicle_images` has 49 triggers, and none writes a cohort edge.

## 3. Spec
`docs/library/PHOTO_COHORT_GRAPH.md` and `supabase/drafts/image-cohort-graph/` (not applied, untested).

## 4. iOS
#3742 adds a photo detail view with a cohort strip. Edges come from real reads only, gaps are named, and private orgs are counted but never named.

Tab recommendation: fold Library into Profile/Garage as "Photos". Don't remove the tab without the owner's yes.

## State log
- #3741 and #3742 are open, waiting on the iOS `build-and-test` CI (about 40–75 min runs). Merge on green: iOS-only, standing approval.
- #3743 is a drafts-only PR. Do not merge.
- The box disk is nearly full (about 515M free). The owner must approve any cleanup.
