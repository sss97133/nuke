# Private financial source derivatives

The product path is `/publishing/finance`: sign in, select documents, start
processing, open a document's evidence, and choose **Review source privacy**.
The browser downloads only that account's private source, verifies its hash,
accepts explicitly drawn or keyboard-entered masks, encodes a fresh RGB PNG and
checks every decoded pixel. The user inspects the exact preview (including an
actual-size option) and confirms it before **Save reviewed private copy** uploads
the immutable derivative and records the review through `ingest-observation`'s
`review_source` action. No CLI, API key or agent subscription is required.
The browser never claims it automatically found all sensitive details. Review
admission is distinct from upload success, and failures provide a retry state.
This path requires the corresponding server action to be deployed; UI tests alone
do not establish a finished live flow. Unsupported browser image formats remain
private and show a review error rather than falling back to an original link.

`redacted-source.mjs` is local preparation, not an upload or a privacy classifier.
Keep originals, mask plans and outputs outside this public repository. Use the
installed `sharp` dependency. Run:

```
node scripts/receipts/redacted-source.mjs ORIGINAL PRIVATE_PLAN.json PRIVATE_OUTPUT.png
```

The mask plan contains `source_sha256`, `width`, `height`,
`coordinate_space: "exif_oriented_pixels"` and `masks: [{x,y,width,height}]`.
Coordinates refer to the EXIF-oriented decoded image, not an OCR guess. A reviewer
must inspect the full image and cover personal/contact/account identifiers,
signatures, faces, identifying codes and vehicle identifiers as required by the
specific disclosure policy. Preserve that evidence in the immutable private source.
Do not infer missing mask coordinates from retained textual line items.

The generator refuses a changed source or invalid bounds, burns opaque black into
RGB pixels, writes only PNG image chunks, and verifies decoded pixels. It creates
files exclusively with private permissions. The manifest deliberately leaves
`visual_reviewed: false`: mechanical checks cannot prove every sensitive region
was found. Independently inspect the exact output at its full resolution before
setting an attributed reviewer and ISO `reviewed_at` for that exact derivative hash.
Changing any bytes requires a new hash and review. Never publish based on the
generator's success alone. No actual private source has been certified by tests.

Admit through the existing authenticated financial writer, after its typed contract
supports `redacted_source`. Add `bucket: "user-documents"` and the exact private
`storage_path: <owner_id>/redacted/<source_sha256>/<derivative_sha256>.png`.
The existing extraction is the attributed review record; supersede it for a new
review. Review assertions are testimony, not server certification. The storage
bucket and owner access policies must be independently verified before admission.

FinanceDashboard accepts only the bound owner/source path and a reviewed manifest,
downloads through the authenticated storage client, checks SHA-256, dimensions and
an image-only PNG chunk allowlist, then uses a short-lived in-memory blob URL.
Failed, unreviewed or superseded copies do not fall back to original storage.
This is a private account reader, not a public document publication path.
Originals and full OCR remain private; line geometry remains unavailable until
observed. Tax computation does not depend on an image overlay.

Focused checks: `node --test scripts/receipts/redacted-source.test.mjs` and the
existing `FinanceDashboard.test.tsx` frontend suite.
