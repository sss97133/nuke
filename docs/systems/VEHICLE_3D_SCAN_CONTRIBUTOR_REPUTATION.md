### Vehicle 3D scans as “qualified knowledge” + contributor reputation (skill tree) + work-order matching

This document describes a **practical reputation system** for contributors who upload 3D scans / reference layers (photogrammetry, LiDAR, measured maps) that improve vehicle spatial accuracy for **any** workflow (inspection, fitment, routing, placement, OEM correctness, etc.). Wiring is one use case, not the definition.

---

### The core theory

- **Vehicle profile (`vehicleId`) is the anchor**: users ask questions inside a vehicle profile.
- **3D models and scan layers are “in the system”**: stored + indexed, not shared via pasted signed URLs.
- **“Awarding knowledge” = qualifying claims**:
  - A contributor’s “claim” is: *“I can produce accurate scan maps / spatial reference layers for this vehicle.”*
  - Validation by others increases confidence in the scan and **trust in the uploader**.
  - The uploader’s “rating” is primarily based on **completed paid scan work** (work orders + receipts), and secondarily supported by validation/dispute history.
  - This rating becomes a **market signal** that drives:
    - who gets matched to scan/inspection work orders
    - what access they have (higher paying jobs, higher trust, less friction)

---

### Entities (conceptual)

- **Base vehicle model**: an authoritative mesh used as the reference frame for a vehicle (or Y/M/M catalog fallback).
- **Reference layer**: a contributed artifact aligned to the base reference frame (scan mesh, point cloud, measurement pack, annotated regions).
- **Validation**: other users confirm accuracy, alignment, scale, and usefulness for tasks.
- **Contributor rating**: a marketplace signal derived from paid scan jobs + outcomes, backed by validation/dispute evidence.

---

### Contribution types (what counts as “scan knowledge”)

- **Scan geometry**:
  - Mesh/scene (preferred web format: `GLB`)
  - Source uploads may include `FBX`, `PLY`, `LAS/LAZ` (converted server-side later)
- **Alignment artifacts**:
  - Anchor points, known dimensions, control markers, transformation metadata
- **Measurement packs**:
  - A list of named dimensions + units + measurement method + confidence
- **Annotations**:
  - Labeled regions (“firewall grommet area”), keep-out volumes, service-access zones

Each contribution can be tagged to a **region** (engine bay, firewall, cab, dash, rear harness route, etc.) and to **tasks** (fitment, routing, inspection).

---

### Validation model (how scans become “qualified”)

Validation is multi-signal. We care about **quality**, **repeatability**, and **anti-gaming**.

- **Automated checks (baseline gate)**:
  - file integrity, size limits, format acceptance
  - bounding box sanity vs expected vehicle envelope
  - scale plausibility checks (e.g., wheelbase range checks by Y/M/M)
  - alignment sanity (anchors not degenerate)
- **Human validation (the real qualifier)**:
  - **Vehicle owner confirmation** (“this matches my truck”) — high weight
  - **Peer review** by validated contributors — medium/high weight
  - **General user review** — low weight, still useful at scale
- **Validation outcomes**:
  - accepted / accepted-with-notes / rejected
  - confidence score (0..1) and reason codes (scale off, misaligned, incomplete region, noisy scan)

**Key principle**: validation should measure *accuracy for tasks*, not “prettiness.”

---

### Contributor rating (what it is)

We do **not** need an invented points/XP system. Money + receipts already prove value.

The rating should be explainable and grounded in **real completed work**:
- **Completed scan work orders** (count)
- **Revenue / receipts** (total and recent)
- **Delivery quality** (acceptance rate, revision rate)
- **Disputes** (chargebacks/complaints, severity-weighted)
- **Validation support** (owner confirmations + peer validations as evidence, not “points”)

Optional (if you want a simple UX label, not a gamified system):
- **Unverified** (no paid jobs yet)
- **Proven** (some paid scan jobs, low disputes)
- **Trusted** (many paid jobs + consistent validations + very low disputes)
- **Specialist** (trusted + strong history in a region/task)

**Promotion** happens by **delivered paid work** (receipts) and **low disputes**, with validation acting as supporting evidence.

---

### How this integrates into work orders + matching

Work orders become a marketplace for “3D spatial tasks,” e.g.:
- “Scan firewall + dash pass-through region for 77 Blazer”
- “Confirm alternator bracket clearance with XYZ kit”
- “Map OEM routing path for brake lines in engine bay”

Matching should use:
- **Vehicle relevance**:
  - exact `vehicleId` (best)
  - Y/M/M match (good)
  - platform family match (acceptable)
- **Skill fit**:
  - required region(s)
  - required task type(s)
  - minimum “proven/trusted” label (optional)
- **Trust score**:
  - weighted outcomes from paid work (acceptance/revision/disputes)
  - dispute rate penalty
  - recent validation boost
- **Operational constraints**:
  - location (if physical scanning needed)
  - turnaround time
  - price band

Outcome: the system can surface:
- “Top 3 recommended contributors”
- “Fastest available trusted contributor”
- “Budget option with lower tier (explicitly labeled)”

---

### Anti-gaming rules (must-have)

- **Weighted validators**: not all validations count equally; validator reputation matters.
- **Conflict-of-interest controls**: flag reciprocal validation rings; discount suspicious patterns.
- **Evidence requirement**: high-impact validations require anchors/measurements/photos.
- **Dispute workflow**: allow owners to challenge; disputes affect reputation.

---

### UI wireframe (chat-first, 3D appears when needed)

The user is always inside a vehicle profile; the assistant calls for 3D when spatial clarity is required.

```text
Vehicle Profile → Chat
  Assistant: “I can’t confirm clearance from text. Opening 3D Inspector.”
  [3D Inspector panel]
    - Base model + contributed reference layers (toggleable)
    - Confidence labels per layer
    - “Validate this layer” action for qualified validators
  Work Order panel (optional)
    - “Need a scan of region X” → posts a scan task → matching suggests top contributors
```

Contributor flow:
```text
Contributor Dashboard
  - Upload scan layer (region tagged)
  - Show validation status: Pending → Accepted/Rejected
  - Rating view: completed paid scans + receipts + dispute rate + recent validations
  - Suggested work orders (matching feed)
```

---

### Tech needs (implementation shape)

- **Storage**:
  - Store source + derived web versions (e.g., FBX + GLB)
  - Store scan layers similarly (source + derived)
- **Database**:
  - Reference layer table: vehicleId/YMM tags, region, task tags, storage paths, transform metadata, confidence
  - Validation table: validator, outcome, weight, reasons
  - Contributor rating materialization: derived from paid scan jobs + outcomes (periodic job)
  - Work orders: task definition, requirements, bids/quotes, assignments, outcomes
- **Policy**:
  - RLS: private-by-default, owner controls visibility; public catalog curated
  - License/consent tracking for re-use in client work (required)


