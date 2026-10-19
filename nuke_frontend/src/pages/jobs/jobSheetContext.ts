import { createContext } from 'react';
import type { JobAction, JsonObject } from './jobRead';

/** What the job page has read, for sheets that prefill from it. Each reader's own answer, unchanged. */
export type JobSheetData = {
  workOrderId: string;
  quotes: JsonObject | null;
  operations: JsonObject | null;
  offers: JsonObject | null;
  invoices: JsonObject | null;
  inspection: JsonObject | null;
  completionSignedAt: string | null;
  reload: () => void;
};

export const JobSheetContext = createContext<JobSheetData | null>(null);

export const SHEET_KINDS = new Set(['issue_quote', 'issue_change_order', 'attest_completion', 'accept_completion', 'issue_invoice', 'record_payment',
  'cosign_provider', 'reserve_facility', 'offer', 'record_findings', 'grant_inspection_access', 'attach_evidence']);

export const hasSheet = (a: JobAction): boolean => a.kind === 'pay_invoice' || SHEET_KINDS.has(a.kind);

