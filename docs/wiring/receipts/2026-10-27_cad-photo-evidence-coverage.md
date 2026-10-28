---
id: 2026-10-27_cad-photo-evidence-coverage
change_type: research
scope: docs/wiring/calc-data/cad/check_dimensions.py, regression tests, and their existing CI registration
---

The owner requested accurate assembly renders using the existing body geometry,
headlamps, hood and retained references, with a concrete account of missing evidence.

The existing source-dimension checker gains an offline `--photo-gate` mode. It
audits saved overlay results without changing models, camera solves, wiring,
production data or visibility defaults. Private photos, outputs and identifiers
remain outside the public repository. Existing factory checks are unchanged.

## Evidence and correction

The private overlay renderer scored posed references even when their camera
records said `gate: false`. It also evaluated point residuals without consulting
the source landmark's `sigma_mm`. A low reprojection residual can coexist with
large uncertainty in absolute placement. The saved reference sets and method
scripts are retained in the private accuracy receipt directory.

The checker now requires explicit camera eligibility, known source uncertainty
within the requested tolerance, finite positive depth, unique points, coverage of
the required named features in two qualifying views, and a declared held-out
validation view. Six distinct points per view is a conservative diagnostic floor;
it does not establish surface accuracy or camera independence. A coverage pass is
named `COVERAGE_CHECK_PASSED`, never a render-accuracy certificate. A held-out label
is a claim whose independence must be reviewed; this script cannot establish it.

Sources: `calc-data/cad/dimensions.yaml` header (source provenance, applicability,
coordinate conventions); `calc-data/cad/tape_list.yaml` T-06 (body/frame placement);
`chapters/18-construction-and-segmentation.md` (design evidence versus physical
confirmation); existing private overlay gate contract (25 mm coarse limit).

## Use

```sh
python check_dimensions.py --photo-gate /private/round/gate.csv \
  --cameras /private/ref/cameras.json \
  --source-landmarks /private/ref/landmarks_twin.csv \
  --requirements /private/required-features.json --output /private/coverage.json
```

Requirements JSON contains `required_landmarks`: the named features selected
before fitting. Camera records explicitly opt in with `gate: true`; independent
validation images additionally declare `validation_role: holdout`. Do not add
these declarations to make an existing fit pass. Select independent evidence.

## Unknowns and acceptance

This is an evidence-producing research change. Whole-surface shape, independent
camera/scale calibration, correspondence to the actual installed part, assembly
fit and appearance remain outside the check. Absolute accuracy requires suitable
source uncertainty and verification at the same physical datums. There is no
unconditional claim of 100% accuracy. The rule files reference HARNESS_RULES.md
and RECEIPT_FORMAT.md, but neither exists in the current tracked tree or shared
wiring directory; existing receipt conventions and current owner scope govern
this research-only change.

Regression acceptance covers one point per image, ineligible vendor references,
undeclared eligibility, uncertainty greater than the limit, omitted features,
duplicate points, fit-only views, invalid residual/depth and unknown cameras.
Twelve focused tests pass locally with the standard-library Python runtime. The
existing source-dimension check passes all 122 entries; its 90 scanned-page
entries still require visual source inspection. The enforced local repository
gate passes. Merge/CI status is recorded separately from these local checks.
