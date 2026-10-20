import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Text } from '../../kit';
import { SignSheet } from './SignSheet';
import { arr, day, money, num, obj, str, type JobAction, type JsonObject } from './jobRead';
import {
  BASES, METHODS, attestArgs, invoiceArgs, invoiceLinesFromQuote, payInvoiceTarget, payRefusal, paymentArgs, paymentSide, stripeCheckoutUrl,
  type InvoiceLineDraft,
} from './signDrafts';
import { termsOf, useWriter } from './useWriter';

export const MONEY_NOTE = "Nuke records payments; it doesn't move money.";

/** attest_work_completion: the provider says the work is done against the accepted quote or the current scope (hash-pinned). */
export function MarkDoneSheet({ action, onClose, onDone }: { action: JobAction; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const w = useWriter();
  const { says, doesNotSay } = termsOf(action);
  const send = async () => {
    const built = attestArgs(action, note);
    if (!built.ok) { w.setFailure(built.error); return; }
    await w.run('attest_work_completion', built.args);
  };
  return <SignSheet title="Mark the work done" says={says} doesNotSay={doesNotSay} confirmLabel="Mark done" onConfirm={send}
    onClose={w.done ? () => { onDone(); onClose(); } : onClose} busy={w.busy} failure={w.failure}
    done={w.done && <Text role="body" className="jb-done">Marked done. The customer can now confirm it.</Text>}>
    {!w.done && <label className="jb-field"><Text role="label">Note for the customer (optional)</Text>
      <textarea className="jb-input k-body" aria-label="Note" maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /></label>}
  </SignSheet>;
}

/** accept_work_completion: the customer confirms that exact provider attestation (hash-pinned by the job path). */
export function ConfirmDoneSheet({ action, signedAt, onClose, onDone }: { action: JobAction; signedAt: string | null; onClose: () => void; onDone: () => void }) {
  const w = useWriter();
  const { says, doesNotSay } = termsOf(action);
  const send = async () => {
    if (action.rpc !== 'accept_work_completion' || !str(action.args.p_completion_hash)) { w.setFailure('This changed since you opened it. Reload and review it again.'); return; }
    await w.run('accept_work_completion', action.args);
  };
  return <SignSheet title="Confirm the work is done" says={says} doesNotSay={doesNotSay} confirmLabel="Confirm it's done" onConfirm={send}
    onClose={w.done ? () => { onDone(); onClose(); } : onClose} busy={w.busy} failure={w.failure}
    done={w.done && <Text role="body" className="jb-done">Confirmed. No payment follows from this by itself.</Text>}>
    <Text role="body">{`The technician marked this work done${day(signedAt) ? ` on ${day(signedAt)}` : ''}.`}</Text>
  </SignSheet>;
}

/** issue_work_order_invoice, prefilled from the accepted quote; offered by work_order_invoices_read (issue_invoice). */
export function IssueInvoiceSheet({ action, quotes, onClose, onDone }: { action: JobAction; quotes: JsonObject | null; onClose: () => void; onDone: () => void }) {
  const acceptance = obj(quotes?.acceptance);
  const current = obj(quotes?.current_quote);
  const accepted = acceptance?.state === 'accepted' && str(acceptance.quote_id) === str(current?.quote_id) ? current : null;
  const [lines, setLines] = useState<InvoiceLineDraft[]>(() => invoiceLinesFromQuote(accepted));
  const [currency, setCurrency] = useState(() => arr(accepted?.lines).map(l => str(obj(l)?.currency)).find(Boolean) ?? 'USD');
  const [due, setDue] = useState('');
  const w = useWriter();
  const { says, doesNotSay } = termsOf(action);
  const update = (i: number, patch: Partial<InvoiceLineDraft>) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const send = async () => {
    const built = invoiceArgs(action, lines, currency, accepted ? str(accepted.quote_id) : null, due);
    if (!built.ok) { w.setFailure(built.error); return; }
    await w.run('issue_work_order_invoice', built.args);
  };
  return <SignSheet title="Issue invoice" says={says} doesNotSay={doesNotSay} confirmLabel="Issue invoice" onConfirm={send}
    onClose={w.done ? () => { onDone(); onClose(); } : onClose} busy={w.busy} failure={w.failure}
    done={w.done && <Text role="body" className="jb-done">Invoice issued. {MONEY_NOTE}</Text>}>
    {!w.done && <>
      <Text role="caption">{accepted ? 'Starts from the accepted quote; change any line that differs.' : 'No accepted quote; each line stands on its own.'}</Text>
      {lines.map((l, i) => <div className="jb-line" key={i} role="group" aria-label={`Invoice line ${i + 1}`}>
        <label className="jb-field"><Text role="label">Description</Text>
          <input className="jb-input k-body" aria-label={`Invoice line ${i + 1} description`} value={l.description} onChange={e => update(i, { description: e.target.value })} /></label>
        <div className="jb-field--row">
          <label className="jb-field"><Text role="label">Priced</Text>
            <select className="jb-input k-body" value={l.basis} onChange={e => update(i, { basis: e.target.value })}>{BASES.map(b => <option key={b.key} value={b.key}>{b.title}</option>)}</select></label>
          <label className="jb-field"><Text role="label">Amount</Text>
            <input className="jb-input k-body" aria-label={`Invoice line ${i + 1} amount`} inputMode="decimal" value={l.amount} onChange={e => update(i, { amount: e.target.value })} /></label>
          {l.basis !== 'flat' && <label className="jb-field"><Text role="label">Quantity</Text>
            <input className="jb-input jb-input--short k-body" inputMode="decimal" value={l.quantity} onChange={e => update(i, { quantity: e.target.value })} /></label>}
        </div>
      </div>)}
      <div><button type="button" className="btn-base btn-xs btn-secondary" onClick={() => setLines(ls => [...ls, { quoteLine: null, description: '', basis: 'flat', amount: '', quantity: '' }])}>
        <Text role="label">Add a line</Text></button></div>
      <div className="jb-field--row">
        <label className="jb-field"><Text role="label">Currency</Text><input className="jb-input jb-input--short k-body" aria-label="Invoice currency" maxLength={3} value={currency} onChange={e => setCurrency(e.target.value)} /></label>
        <label className="jb-field"><Text role="label">Due (optional)</Text><input type="date" className="jb-input k-body" aria-label="Due date" value={due} onChange={e => setDue(e.target.value)} /></label>
      </div>
    </>}
  </SignSheet>;
}

const today = () => new Date().toISOString().slice(0, 10);

/** record_work_order_payment: a witness that a payment happened, as payer ("I paid") or payee ("I received"). */
export function RecordPaymentSheet({ action, invoice, onClose, onDone }: { action: JobAction; invoice: JsonObject | null; onClose: () => void; onDone: () => void }) {
  const side = paymentSide(action);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('bank_transfer');
  const [paidAt, setPaidAt] = useState(today());
  const [reference, setReference] = useState('');
  const w = useWriter();
  const { says, doesNotSay } = termsOf(action);
  const send = async () => {
    const built = paymentArgs(action, invoice, amount, method, paidAt, reference);
    if (!built.ok) { w.setFailure(built.error); return; }
    await w.run('record_work_order_payment', built.args);
  };
  const currency = str(invoice?.currency) ?? 'USD';
  return <SignSheet title={side === 'payer' ? 'I paid' : 'I received a payment'} says={says} doesNotSay={doesNotSay} confirmLabel="Record payment" onConfirm={send}
    onClose={w.done ? () => { onDone(); onClose(); } : onClose} busy={w.busy} failure={w.failure}
    done={w.done && <Text role="body" className="jb-done">{side === 'payer' ? 'Recorded. The shop confirms when it arrives.' : 'Recorded as received.'} {MONEY_NOTE}</Text>}>
    <Text role="caption">{MONEY_NOTE}</Text>
    {!w.done && <>
      <Text role="body">{`Invoice version ${num(invoice?.version) ?? 1}, total ${money(num(invoice?.total), currency)}.`}</Text>
      <div className="jb-field--row">
        <label className="jb-field"><Text role="label">{`Amount (${currency})`}</Text>
          <input className="jb-input k-body" aria-label="Payment amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <label className="jb-field"><Text role="label">How</Text>
          <select className="jb-input k-body" aria-label="Payment method" value={method} onChange={e => setMethod(e.target.value)}>{METHODS.map(m => <option key={m.key} value={m.key}>{m.title}</option>)}</select></label>
        <label className="jb-field"><Text role="label">Date</Text>
          <input type="date" className="jb-input k-body" aria-label="Payment date" value={paidAt} max={today()} onChange={e => setPaidAt(e.target.value)} /></label>
      </div>
      <label className="jb-field"><Text role="label">Reference (optional)</Text>
        <input className="jb-input k-body" aria-label="Payment reference" maxLength={200} value={reference} onChange={e => setReference(e.target.value)} /></label>
      <Text role="caption">The reference and amount are shown only to the people on this job.</Text>
    </>}
  </SignSheet>;
}

/**
 * Pay by card: the server's pay_invoice action opens Stripe Checkout for exactly the balance it states, through the same
 * create-work-order-invoice-checkout function the app uses. Nothing is charged until the customer finishes on Stripe.
 */
export function PayByCard({ action }: { action: JobAction }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const target = payInvoiceTarget(action);
  if (!target) return null;
  const amount = num(action.raw.amount), currency = str(action.raw.currency);
  const pay = async () => {
    setBusy(true); setFailure(null);
    const { data, error } = await supabase.functions.invoke('create-work-order-invoice-checkout', { body: { work_order_id: target } });
    setBusy(false);
    const url = stripeCheckoutUrl(obj(data)?.checkout_url);
    if (!error && url) { window.location.assign(url); return; }
    const response = (error as { context?: { status?: number; json?: () => Promise<unknown> } } | null)?.context;
    const body = obj(data) ?? obj(await response?.json?.().catch(() => null));
    setFailure(response?.status === 401 ? 'Sign in to pay this invoice.' : payRefusal(str(body?.refused)));
  };
  return <div className="job-sign" role="group" aria-label="Pay by card">
    <Text role="label">Pay by card</Text>
    {amount !== null && <Text role="measure" dense>{money(amount, currency)}</Text>}
    <Text role="caption">Opens Stripe for the balance due. Nothing is charged until you finish there; it does not accept the work or release money to the provider.</Text>
    <button type="button" className="job-button job-button--primary" disabled={busy} onClick={pay}><Text role="label">{busy ? 'Opening Stripe…' : 'Pay by card'}</Text></button>
    {failure && <Text role="body" className="job-sign__failure">{failure}</Text>}
  </div>;
}
