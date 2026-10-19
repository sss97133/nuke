import React, { useContext, useState } from 'react';
import { JobSheetContext, SHEET_KINDS, type JobSheetData } from './jobSheetContext';
import { Text } from '../../kit';
import { actionTitle, arr, obj, personLabel, str, type JobAction, type JsonObject } from './jobRead';
import { ChangeOrderSheet, IssueQuoteSheet } from './QuoteSheets';
import { ConfirmDoneSheet, IssueInvoiceSheet, MarkDoneSheet, PayByCard, RecordPaymentSheet } from './CloseoutSheets';
import { CosignSheet, ReserveFacilitySheet } from './PeopleSheets';
import { OfferSheet } from './JobSheets';

function offerFor(offers: JsonObject | null, offerId: string | null): JsonObject | null {
  for (const r of arr(offers?.requirements).map(obj)) {
    for (const o of arr(r?.offers).map(obj)) if (o && str(o.offer_id) === offerId) return o;
  }
  return null;
}

function requirementText(offers: JsonObject | null, requirementId: string | null): string {
  const r = arr(offers?.requirements).map(obj).find(x => str(x?.requirement_id) === requirementId);
  return str(r?.description) ?? 'This request';
}

function currentInvoice(invoices: JsonObject | null): JsonObject | null {
  const id = str(invoices?.current_invoice_id);
  const list = arr(invoices?.invoices).map(obj).filter((o): o is JsonObject => !!o);
  return list.find(i => str(i.invoice_id) === id) ?? list.find(i => i.current === true) ?? null;
}

function Sheet({ action, data, onClose }: { action: JobAction; data: JobSheetData; onClose: () => void }) {
  const done = data.reload;
  switch (action.kind) {
    case 'issue_quote': return <IssueQuoteSheet action={action} operations={data.operations} quotes={data.quotes} onClose={onClose} onDone={done} />;
    case 'issue_change_order': return <ChangeOrderSheet action={action} quotes={data.quotes} onClose={onClose} onDone={done} />;
    case 'attest_completion': return <MarkDoneSheet action={action} onClose={onClose} onDone={done} />;
    case 'accept_completion': return <ConfirmDoneSheet action={action} signedAt={data.completionSignedAt} onClose={onClose} onDone={done} />;
    case 'issue_invoice': return <IssueInvoiceSheet action={action} quotes={data.quotes} onClose={onClose} onDone={done} />;
    case 'record_payment': return <RecordPaymentSheet action={action} invoice={currentInvoice(data.invoices)} onClose={onClose} onDone={done} />;
    case 'cosign_provider': {
      const o = offerFor(data.offers, str(action.args.p_offer_id));
      return <CosignSheet action={action} offerWho={personLabel(o?.offer_kind === 'organization' ? o?.facility ?? o?.provider : o?.provider)} onClose={onClose} onDone={done} />;
    }
    case 'reserve_facility': return <ReserveFacilitySheet action={action} onClose={onClose} onDone={done} />;
    case 'offer':
      return <OfferSheet action={{ action: action.kind, rpc: action.rpc ?? undefined, args: action.args, as: obj(action.raw.as) }}
        requestTitle={requirementText(data.offers, str(action.args.p_requirement_id))} onClose={() => { done(); onClose(); }} />;
    default: return null;
  }
}

/** A server-offered step that needs the signer's input: a button that opens its sheet. */
export function ActionSheetLauncher({ action }: { action: JobAction }) {
  const data = useContext(JobSheetContext);
  const [open, setOpen] = useState(false);
  if (action.kind === 'pay_invoice') return <PayByCard action={action} />;
  if (!data || !SHEET_KINDS.has(action.kind)) return null;
  const title = actionTitle(action);
  return <div className="job-sign" role="group" aria-label={title}>
    <Text role="label">{title}</Text>
    <button type="button" className="job-button" onClick={() => setOpen(true)}><Text role="label">{title}</Text></button>
    {open && <Sheet action={action} data={data} onClose={() => setOpen(false)} />}
  </div>;
}
