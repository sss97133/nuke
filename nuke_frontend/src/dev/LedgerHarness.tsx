// FIXTURES ARE ILLUSTRATIVE — NEVER CITE OR INGEST.
// These rows exist only to render BuildLedger for visual review. They are not
// substrate: do not quote their amounts, citations, or dates as fact anywhere.
//
// THROWAWAY DEV HARNESS — visual verification of BuildLedger only.
// NOT imported by the app bundle (only by ledger-harness.html dev entry).
// Renders BuildLedger with fixture rows shaped exactly like the
// get_vehicle_build_ledger RPC payload, inside the real profile column CSS.
// Amounts track real audit-substrate shapes where one exists; where the real
// observation is unconfirmed testimony (e.g. the Kenan capital row), the fixture
// mirrors that uncertainty rather than inventing a matched bank citation.

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BuildLedger from '../pages/vehicle-profile/BuildLedger';
import AgentChat from '../components/agent/AgentChat';

// Row shape mirrors RawLedgerRow in useBuildLedger.ts
export interface HarnessRawRow {
  observation_id: string;
  observed_at: string | null;
  content_text: string | null;
  structured_data: Record<string, unknown>;
}

const RUN = 'audit_draft_v0 2026-07-07';

export const FIXTURE_ROWS: HarnessRawRow[] = [
  // ── Parts ──
  {
    observation_id: 'fx-001',
    observed_at: '2019-03-09T00:00:00Z',
    content_text: 'Motec RBD 190 remote battery disconnect (Desert Performance invoice line)',
    structured_data: {
      amount_usd: 300.0, direction: 'out', event_type: 'parts_purchase',
      counterparty: 'Desert Performance', entity_paid: 'skylar',
      evidence_tier: 'bank', attribution_tier: 'certain',
      attribution_basis: 'qb_vehicle_id_link', channel: 'card',
      citation: { qb_transactions: 'invoice-desert-performance-rbd-190-remote-battery-disconnect' },
      needs_owner_confirmation: false, confirmation_question: null,
      order_total_usd: null, split_method: null, audit_run: RUN,
    },
  },
  {
    observation_id: 'fx-002',
    observed_at: '2019-03-09T00:00:00Z',
    content_text: 'XRP -6 braided fuel line, 20 ft (Desert Performance invoice line)',
    structured_data: {
      amount_usd: 120.0, direction: 'out', event_type: 'parts_purchase',
      counterparty: 'Desert Performance', entity_paid: 'skylar',
      evidence_tier: 'bank', attribution_tier: 'certain',
      attribution_basis: 'qb_vehicle_id_link', channel: 'card',
      citation: { qb_transactions: 'invoice-desert-performance-xrp-6-braided-fuel-line-20ft' },
      needs_owner_confirmation: false, confirmation_question: null,
      order_total_usd: null, split_method: null, audit_run: RUN,
    },
  },
  {
    observation_id: 'fx-003',
    observed_at: '2022-09-13T00:00:00Z',
    content_text: 'Holley order — Terminator X Max + main harness',
    structured_data: {
      amount_usd: 1596.53, direction: 'out', event_type: 'parts_purchase',
      counterparty: 'Holley Performance', entity_paid: 'viva_account',
      evidence_tier: 'bank_matched', attribution_tier: 'certain',
      attribution_basis: 'card_descriptor_match', channel: 'card',
      citation: {
        qb_transactions: 'purchase-2693-1',
        bank_match: 'VISA - 09/10 HOLLEY PERFORMANCE PRODUC 800-6380032 KY 004',
      },
      needs_owner_confirmation: false, confirmation_question: null,
      order_total_usd: 1596.53, split_method: null, audit_run: RUN,
    },
  },
  {
    observation_id: 'fx-004',
    observed_at: '2023-04-02T00:00:00Z',
    content_text: 'Summit Racing order SR-10442871 — fuel pump, filters, AN fittings (7 line items)',
    structured_data: {
      amount_usd: 842.17, direction: 'out', event_type: 'parts_purchase',
      counterparty: 'Summit Racing', entity_paid: 'skylar',
      evidence_tier: 'email_itemized', attribution_tier: 'certain',
      attribution_basis: 'itemized_receipt_email', channel: 'card',
      citation: { gmail_msg_id: '1877f3ab9c2d4e10' },
      needs_owner_confirmation: false, confirmation_question: null,
      order_total_usd: 842.17, split_method: 'line_item_total', audit_run: RUN,
    },
  },
  {
    observation_id: 'fx-005',
    observed_at: '2024-01-18T00:00:00Z',
    content_text: 'RockAuto order 231098765 — brake hardware; ship-to matches two trucks',
    structured_data: {
      amount_usd: 214.88, direction: 'out', event_type: 'parts_purchase',
      counterparty: 'RockAuto', entity_paid: 'viva_account',
      evidence_tier: 'bank', attribution_tier: 'likely',
      attribution_basis: 'vendor_category_prior', channel: 'card',
      citation: {
        bank_match: 'ROCKAUTO.COM 608-6617407 WI',
        conflict: 'brake hardware fits both the K5 and the 1995 Suburban',
      },
      needs_owner_confirmation: true,
      confirmation_question: 'Was RockAuto order 231098765 (brake hardware, $214.88) for the K5 or the 1995 Suburban?',
      order_total_usd: null, split_method: null, audit_run: RUN,
    },
  },
  {
    observation_id: 'fx-006',
    observed_at: '2024-03-06T00:00:00Z',
    content_text: 'K5 seat brackets, used pair (eBay seller mtnclassics)',
    structured_data: {
      amount_usd: 185.0, direction: 'out', event_type: 'parts_purchase',
      counterparty: 'eBay — mtnclassics', entity_paid: 'skylar',
      evidence_tier: 'text_likely', attribution_tier: 'probable',
      attribution_basis: 'imessage_self_report', channel: 'paypal',
      citation: { imessage: "2024-03-06 'grabbed those seat brackets off ebay for 185'" },
      needs_owner_confirmation: false, confirmation_question: null,
      order_total_usd: null, split_method: null, audit_run: RUN,
    },
  },

  // ── Labor ──
  {
    observation_id: 'fx-007',
    observed_at: '2024-02-20T00:00:00Z',
    content_text: 'Zelle to Howard Bieber — cab + bed bodywork progress payment',
    structured_data: {
      amount_usd: 2500.0, direction: 'out', event_type: 'labor_payment',
      counterparty: 'Howard Bieber', entity_paid: 'skylar',
      evidence_tier: 'bank_matched', attribution_tier: 'probable',
      attribution_basis: 'zelle_counterparty_history', channel: 'zelle',
      citation: { bank_match: 'ZELLE HOWARD BIEBER 866-224-2158;405000L0AWRB;2024-02-20;DR' },
      needs_owner_confirmation: false, confirmation_question: null,
      order_total_usd: null, split_method: null, audit_run: RUN,
    },
  },
  {
    observation_id: 'fx-008',
    observed_at: '2024-03-02T00:00:00Z',
    content_text: 'Zelle to Gary Lake — panel fab + door alignment',
    structured_data: {
      amount_usd: 1208.0, direction: 'out', event_type: 'labor_payment',
      counterparty: 'Gary Lake', entity_paid: 'skylar',
      evidence_tier: 'bank_matched', attribution_tier: 'certain',
      attribution_basis: 'imessage_corroborated_bank_row', channel: 'zelle',
      citation: {
        bank_match: 'ZELLE GARY LAKE 866-224-2158;406200I00JE8;2024-03-04;DR',
        imessage: "2024-03-01 Gary: 'doors are hung, 1208 covers it'",
      },
      needs_owner_confirmation: false, confirmation_question: null,
      order_total_usd: null, split_method: null, audit_run: RUN,
    },
  },
  {
    observation_id: 'fx-009',
    observed_at: '2024-04-11T00:00:00Z',
    content_text: "Zelle to Tommy — paint prep, stated 'were square on the blazer'",
    structured_data: {
      amount_usd: 1100.0, direction: 'out', event_type: 'labor_payment',
      counterparty: 'Tommy', entity_paid: 'skylar',
      evidence_tier: 'text_likely', attribution_tier: 'probable',
      attribution_basis: 'imessage_amount_match', channel: 'zelle',
      citation: {
        imessage: "2024-04-10 Tommy: 'send 1100 and were square on the blazer'",
        bank_match: 'ZELLE payment 2024-04-11 DR 1100.00',
      },
      needs_owner_confirmation: true,
      confirmation_question: 'Tommy was paid $1,100 by Zelle on Apr 11 2024 — was the full amount K5 paint prep, or split with other shop work?',
      order_total_usd: null, split_method: null, audit_run: RUN,
    },
  },
  {
    observation_id: 'fx-010',
    observed_at: '2024-05-20T00:00:00Z',
    content_text: 'Paint balance — stated amount, no bank match found in AFCU or Viva exports',
    structured_data: {
      amount_usd: 3500.0, direction: 'out', event_type: 'labor_payment',
      counterparty: 'Painter (unresolved)', entity_paid: 'skylar',
      evidence_tier: 'testimony', attribution_tier: 'stated',
      attribution_basis: 'owner_statement_2026_06', channel: null,
      citation: { testimony: "Skylar 2026-06: 'paint was about thirty-five hundred'" },
      needs_owner_confirmation: false, confirmation_question: null,
      order_total_usd: null, split_method: null, audit_run: RUN,
    },
  },

  // ── Capital ──
  {
    observation_id: 'fx-011',
    observed_at: '2022-05-16T00:00:00Z',
    content_text: 'Kenan build capital — SouthState wire notice 2022-05-16 (no amount on notice); principal unconfirmed, repayable at sale',
    structured_data: {
      amount_usd: 9000.0, direction: 'liability', event_type: 'capital_investment',
      counterparty: 'Kenan', entity_paid: 'kenan_capital',
      evidence_tier: 'testimony', attribution_tier: 'stated',
      attribution_basis: 'imessage_kenan_thread_unreconciled', channel: 'wire',
      citation: {
        imessage: 'Kenan thread',
        testimony: 'vehicle_observations a8050f21',
      },
      needs_owner_confirmation: true,
      confirmation_question: 'Kenan wired build capital (SouthState wire notice 2022-05-16 shows no amount) — confirm the principal (~$9,000?) and that it is a repayable loan, not equity in the truck.',
      order_total_usd: null, split_method: null, audit_run: RUN,
    },
  },
  {
    observation_id: 'fx-012',
    observed_at: '2024-06-01T00:00:00Z',
    content_text: 'Running balance owed to Viva account for direct-paid parts orders',
    structured_data: {
      amount_usd: 2750.0, direction: 'liability', event_type: 'capital_investment',
      counterparty: 'Viva account', entity_paid: 'viva_account',
      evidence_tier: 'testimony', attribution_tier: 'stated',
      attribution_basis: 'commingling_reconciliation_draft', channel: null,
      citation: {
        testimony: 'Reconciliation draft: Viva card paid K5 vendor orders directly; owed back on separation of accounts',
        split_method: 'sum_of_viva_paid_rows',
      },
      needs_owner_confirmation: false, confirmation_question: null,
      order_total_usd: null, split_method: 'sum_of_viva_paid_rows', audit_run: RUN,
    },
  },
];

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

// 36+ chars so the hook's `vehicleId.length >= 20` gate passes.
const HARNESS_VEHICLE_ID = 'harness-vehicle-0000-0000-000000000000';

const LedgerHarness: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);

  return (
    <QueryClientProvider client={queryClient}>
      <div
        className="vehicle-profile-page"
        style={{ minHeight: '100vh', background: 'var(--vp-bg)', padding: '24px' }}
      >
        {/* Mimic the real mount: left column (30% of profile ≈ 420px on desktop) */}
        <div
          className="vp-col-left vehicle-profile-left-column"
          style={{ width: '420px', height: 'auto', overflow: 'visible', border: '1px solid var(--vp-ghost)' }}
        >
          <BuildLedger vehicleId={HARNESS_VEHICLE_ID} />
          <AgentChat vehicleId={HARNESS_VEHICLE_ID} />
        </div>
      </div>
    </QueryClientProvider>
  );
};

export default LedgerHarness;
