# Source refresh funding

Implementation lives in the existing Sources board, `create-api-access-checkout`,
`stripe-webhook` and `poll-listing-feeds`. Payments retain payer cash-out testimony
in `payment_events`; `extraction_runs` holds the stored quote and operational
receipt. A source contribution does not also create spendable personal credits.

This work is **not an implemented Stripe-to-provider transfer**. Stripe proceeds,
Nuke wallet credit and provider credit are different balances. Provider auto-reload
uses the payment method configured with the provider. Its connection to the
platform's settlement funds needs separate operational verification. Do not enable
checkout merely because the webhook or the local tests pass.

Paid checkout and paid dispatch now refuse unconditionally while the source-bound
provider reservation/settlement owner is missing. `billing_verified` alone does
not bypass this hold. Existing paid receipts are retained for review, not silently
run. `fundingBudget.ts` distinguishes actual input/output units priced from an
attributed tariff, provider settlement, and their variance. Missing units/cost,
unsupported cache billing, or mismatched settlement are unknown, never zero.
This accounting contract does not yet reserve future API calls or enforce a
monthly provider-dollar budget. Contribution price is never substituted for cost.

`platform_config.source_refresh_funding` is absent by default and no enabled
configuration is seeded. An enabled paid source policy must supply `needs_funding=true`, `feed_source`,
`provider`, `amount_cents`, `max_ingests`, `replenishment_mode=provider_auto_reload`,
`billing_verified=true` and a private `billing_reference` identifying real
replenishment evidence. The configuration's top-level and per-source `enabled`
switches must both be true. Prices come from this stored policy. Collector and
source-intake switches remain authoritative; contributions cannot enable them.

An already funded source can instead set `needs_funding=false`, `amount_cents=0`,
`allow_provider_charges=false` and a verified `subscription_credit` capacity
reference. Provider auto-reload is not allowed on this no-new-charge path.
The same Refresh control then queues existing capacity without Stripe or payment
testimony. New requests use the existing atomic `rate_limit_increment` owner:
one free request per user/source per fifteen-minute window; paid checkout requests
are capped at five per user/source. Both share at most three new requests across
all users and source aliases of the same feed per window. A rate-limit read
failure stops new work. Retries reuse their request. This limits admissions, not
provider dollars; it is not a monthly spending cap.

The webhook accepts paid live one-time sessions only. The stored quote binds the
payer, source, amount and mode. One session creates one payment receipt and queues
one refresh atomically, including when different webhook event IDs describe the
same session. The browser's return URL never confirms payment.

The checkout also binds its PaymentIntent metadata. Confirmed `refund.created`
and `refund.updated` events append separate incoming payer testimony once per
refund, including partial refunds, and stop queued work. Dispute-created/closed
events preserve their source clocks and history and hold work for review. They do
not invent a refund or automatically restart a paid attempt. Existing captures and
the original payment remain intact. The existing Stripe event destination must
subscribe to these four event types before activation.

The existing schedule recovers queued funding receipts. An atomic per-feed lease
serializes different contributors' funded requests, without force, with a maximum of five listing
admissions and the current lower intake limits. The existing intake receipt must
acknowledge the same source's progress before completion is shown. A lost or failed
attempt enters `needs_review` and retains the feed lease; it does not silently
start another paid attempt. Refund/dispute status changes do not drop an in-flight
lease. Definitive completion or a confirmed no-attempt releases it. This lease
also coordinates ordinary polling through an opt-in per-feed operational lease
when the funding policy enables that source. Absent policy preserves ordinary
poll behavior; no running configuration is enabled by this draft.
If the begin receipt fails before source work, the lease releases and the request
fails without a source call. Once a source attempt starts, an error conservatively
holds the lease for reconciliation: an acknowledged HTTP error is not proof that
the provider incurred no charge. A completed zero-result poll can release normally.
Feed completion is distinct from queued listings finishing extraction.

Before activation, demonstrate the provider account/key association, actual
replenishment, signed live payment receipt, source intake and consumer together,
plus the deployed reversal/refund event subscriptions. Current source/privacy/collector holds still apply.
Account-side setup and this acceptance case remain open until separately evidenced.
