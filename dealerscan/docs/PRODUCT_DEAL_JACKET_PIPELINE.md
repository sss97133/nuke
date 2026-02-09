# Deal jacket pipeline: how we handle your data

This is the **paid service** we are developing in **n-zero**. The goal: automate folder naming and turn raw deal-jacket images into a **per-car repository** that can be viewed and queried.

**Core principle: users must be able to SEE how their data is handled.** Transparency—where each file went, which deal it belongs to, how we named folders—builds trust and confirms we captured everything correctly.

---

## Two ways users give us data

### 1. Select **file(s)**

User picks one or more files (images, PDFs). **Our responsibility:**

- **Create the folder** (we own structure).
- **Auto-name the folder** from extracted data (VIN, year-make-model, deal date).
- **Divide the images** by detecting where each new deal jacket starts—so each receipt/document lands in the right deal.

**Success =** we automate and correctly understand **where each receipt goes**. Every receipt has some kind of pattern (document type, VIN, header, layout) that helps us know where the **cutoff** is. We’re helped by the fact that input is usually **chronological**: each time we see a **new recognizable deal jacket** (new cover sheet, new title, new VIN, new vehicle), that’s the start of the next deal. We use those boundaries to split the stream of images into one packet per car, then create one vehicle profile per packet.

- **One image** → one deal; we auto-name from that document.
- **Many images** → we **separate first** (see below), then one folder/deal per group, each auto-named.

### 2. Select **folder**

User picks an **already-organized folder** (e.g. one folder per vehicle, containing PDFs, JPEGs, etc.). **Our responsibility:**

- Treat **that folder = one vehicle profile**.
- **Reach the database**: create or update the vehicle profile, trigger the pipeline for that folder.
- **Link it to the organization** (dealer/org it’s associated with).

This is **simpler** than file mode because the user did the grouping; we don’t have to detect boundaries—we just process the folder as one deal and write to the DB, then associate with the org.

---

## Separation logic (when user selects file(s))

When we get a **sequence of files** (not a pre-grouped folder), we must **separate** them into N deal jackets before creating N folders/deals.

- **Patterns:** Every receipt/doc has patterns (document type, VIN, title block, dealer header, date) that signal “this belongs to car A” vs “this is the start of car B.”
- **Chronological:** Order is our friend. As we walk the sequence, each time we see a **new recognizable deal jacket** (e.g. new cover, new title, new VIN), that’s the **cutoff**—everything after that belongs to the next deal until the next cutoff.
- **Output:** N groups. Each group = one packet → one folder (auto-named) → one vehicle profile in the DB.

So: **file(s) in → we create folder(s), auto-name, and divide by “new deal jacket” boundaries; folder in → we treat one folder as one vehicle profile and link it to the org.**

---

## Pipeline (target)

```
[User input]
     │
     ├── Select FOLDER  ──► One folder = one vehicle profile
     │                     • Process folder → create/update vehicle profile in DB
     │                     • Link to organization
     │
     └── Select FILE(S) ──► We create folder(s) and divide
                            │
                            ▼
                    ┌───────────────────────────────────────────┐
                    │ 1. SEPARATE by “new deal jacket” boundaries │
                    │    • Chronological + patterns (VIN, doc type,   │
                    │      cover/title) → cutoffs                      │
                    │    • Output: N groups (one per car)              │
                    └───────────────────────────────────────────┘
                            │
                            ▼
                    ┌───────────────────────────────────────────┐
                    │ 2. For each group: auto-name folder,          │
                    │    create packet → extract → merge             │
                    └───────────────────────────────────────────┘
                            │
                            ▼
                    ┌───────────────────────────────────────────┐
                    │ 3. Per-car repository in DB + link to org  │
                    │    • View & query; user SEES how data was  │
                    │      handled (which file → which deal)     │
                    └───────────────────────────────────────────┘
```

---

## User visibility: “See how your data is handled”

Users need to **see**:

- **Which files** were grouped into **which deal** (which folder / which vehicle profile).
- **How we named** each folder/deal (VIN, YMM, date).
- **What we extracted** (document types, counts: title, bill of sale, receipts, etc.) so they can confirm “that was the big jacket” vs “that was the small one” and trust the DB.

So the product should expose: file → deal mapping, auto-generated names, and document-type breakdown per deal. That’s how we show “your data was handled correctly.”

---

## Automating folder / deal names

- When **we** create the folder (file mode): name from extracted data, e.g. `{VIN}`, `{year} {make} {model}`, or `{deal_date} - {VIN}`.
- When user gives a **folder** (folder mode): we can still derive display name from contents (VIN, YMM) for the vehicle profile.

---

## Connect photos (external galleries)

Users should be able to **connect image galleries from external sources** (e.g. **SmugMug**, Flickr, Google Photos, etc.) instead of (or in addition to) uploading files.

- **Same pattern as Bring a Trailer:** We have access to the images but **we don’t download them**—we keep them where they are. We store **references only** (image URLs, album/gallery IDs, optional folder structure).
- **We still use them in analysis:** When we need to run OCR, extraction, or display, we **fetch by URL** (or use the provider’s API). Analysis runs on the same pipeline (document type, YMM/VIN, separation); we just don’t persist the image bytes in our storage.
- **Flow:** User connects a gallery (OAuth or API key or share link) → we discover image URLs (and any album/collection structure) → we store those references and link them to a deal/vehicle profile → we run separation and extraction by loading images from the source when needed. Display in the app uses the original URLs (or signed/temporary URLs if the source requires it).

So: **Connect photos** = connect external gallery → reference-only storage → same analysis and organization as uploaded files, without copying the images.

---

## Bulk export and connect to profile

- **Bulk export:** Users need to export all deal jackets in one shot (e.g. one JSON or ZIP) so they can move data into their workflow or the framework. Single-deal export exists; add **bulk export** (all deals + pages) as one file.
- **Connect to profile:** The data is already tied to a profile in the system, but nobody can use it without **the framework** (n-zero, vehicle profile, org). So we need an explicit **Connect to profile** (or **Open in n-zero**) entry point: from a deal jacket, open the corresponding vehicle/org profile in the app where they have the framework to view and use the data.
- **Upload photos:** Add an **Upload photos** option that does the **same thing** as the deal jacket flow: image analysis, organization (separate by deal jacket), naming (YMM/VIN), extraction, and link to profile. Same pipeline—just another entry point (e.g. from a vehicle profile: “Upload photos” → same analysis and organization, then attached to that profile).

---

## Delivered as paid service in n-zero

- This pipeline (file vs folder input, separation, auto-naming, per-car repository, link to org) is the **paid service**.
- **Transparency** (users see how their data is handled) is part of the product.
- **Bulk export** and **Connect to profile** make the data usable inside the framework.
- **Upload photos** (same analysis + organization) is the entry point from profiles.
- Billing/credits apply to extraction and usage; product surface lives in **n-zero**.

---

## Current state vs target

| Area | Current | Target |
|------|---------|--------|
| Input | Upload files or pick folder (folder → one deal) | **Select file(s)** OR **select folder** OR **connect external gallery** (SmugMug, etc.); file(s) → we create folder(s) and separate |
| External galleries | N/A | **Connect photos:** link SmugMug etc.; store image URLs only, no download; use URLs for analysis (like BaT) |
| Separation | None (all files → one deal) | Detect “new deal jacket” boundaries; one deal per car |
| Naming | Manual or folder name | Auto-name from VIN / YMM / date when we create folder |
| Folder mode | Folder = one deal | Folder = one vehicle profile; create in DB, link to org |
| Visibility | Basic deal view | User SEES: which file → which deal, auto names, doc-type breakdown |

This doc is the product spec; implementation will live in n-zero and in shared extraction/merge logic (e.g. DealerScan edge functions and DB schema as needed).
