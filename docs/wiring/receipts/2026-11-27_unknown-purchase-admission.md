# Unknown purchase state on admission

Change type: admission and retained editor correction. PostgreSQL allowed NULL purchase state but still defaulted an omitted value to false. The retained local device editor supplied the same unsupported negative default. Missing acquisition information therefore became an explicit negative claim before a reader could distinguish it.

Drop only the database insertion default and use NULL for a locally added device whose input omits purchase state. Existing rows and explicit true, false and NULL inputs retain their values. This does not qualify the evidence for any explicit claim, change device choice, establish stock, or authorize an order. The existing reviewed-withdrawal guard remains intact.

Source: actual `vehicle_build_manifest.purchased` column metadata and the `useOverlayCompute` admission path. The earlier 20 source-reviewed invoice withdrawals are a separate correction; the remaining historical boolean values still need source qualification. No blanket historical rewrite is included.

Verification: native PostgreSQL17 and rendered editor regressions reproduce the original defaults before the fix. The native contract applies the actual migration as a non-superuser table owner, preserves every existing row, and exercises omitted and explicit states through a minimally privileged admission role. The rendered editor checks omitted and undefined input, explicit true/false/NULL, and the downstream not-purchased count. Release must also pass the existing consumer checks, enforced repository gate and normal checked CI, then verify the live column definition and unchanged source rows. No synthetic production device is created.
