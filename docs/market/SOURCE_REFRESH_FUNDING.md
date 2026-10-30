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

`platform_config.source_refresh_funding` is absent by default and no enabled
configuration is seeded. An enabled paid source policy must supply `needs_funding=true`, `feed_source`,
`provider`, `amount_cents`, `max_ingests`, `replenishment_mode=provider_auto_reload`,
`billing_verified=true` and a private `billing_reference` identifying real
replenishment evidence. The configuration's top-level and per-source `enabled`
switches must both be true. Prices come from this stored policy. Collector and
source-intake switches remain authoritative; contributions cannot enable them.

An already funded source can instead set `needs_funding=false`, `amount_cents=0`
and a verified `provider_auto_reload` or `subscription_credit` capacity reference.
The same Refresh control then queues existing capacity without Stripe or payment
testimony. New requests use the existing atomic `rate_limit_increment` owner:
one free request per user/source per fifteen-minute window, with three across all
users for the source; paid checkout requests are capped at five per user/source
per window. A rate-limit read failure stops new work. Retries reuse their request.

The webhook accepts paid live one-time sessions only. The stored quote binds the
payer, source, amount and mode. One session creates one payment receipt and queues
one refresh atomically, including when different webhook event IDs describe the
same session. The browser's return URL never confirms payment.

The existing schedule recovers queued funding receipts. A compare-and-set claim
dispatches one enabled feed, without force, with a maximum of five listing
admissions and the current lower intake limits. The existing intake receipt must
acknowledge the same source's progress before completion is shown. A lost or failed
attempt enters `needs_review`; it does not silently start another paid attempt.
Feed completion is distinct from queued listings finishing extraction.

Before activation, demonstrate the provider account/key association, actual
replenishment, signed live payment receipt, source intake and consumer together,
plus reversal/refund handling. Current source/privacy/collector holds still apply.
Account-side setup and this acceptance case remain open until separately evidenced.
