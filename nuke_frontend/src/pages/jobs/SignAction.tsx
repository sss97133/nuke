import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Text } from '../../kit';
import { actionTitle, isWebSign, signFailure, signTerms, type JobAction } from './jobRead';
import { ActionSheetLauncher } from './ActionSheets';
import { JobSheetContext, hasSheet } from './jobSheetContext';

type Phase = { step: 'idle' } | { step: 'confirming' } | { step: 'working' } | { step: 'done' } | { step: 'failed'; reason: string };

/**
 * One Sign the server offered this viewer. Signing passes back exactly the writer and arguments the reader named,
 * after the person has read what it says and what it does not. Steps that need the signer's own input stay in the app.
 */
export function SignAction({ action, onSigned }: { action: JobAction; onSigned?: () => void }) {
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });
  const sheets = React.useContext(JobSheetContext);
  const title = actionTitle(action);

  if (!isWebSign(action) && hasSheet(action) && (sheets || action.kind === 'pay_invoice')) return <ActionSheetLauncher action={action} />;
  if (!isWebSign(action)) {
    return <div className="job-sign" role="group" aria-label={title}>
      <Text role="label">{title}</Text>
      <Text role="caption">Offered to you. Open the Nuke app to do this; it needs your own details.</Text>
    </div>;
  }

  const { says, doesNotSay } = signTerms(action);
  const sign = async () => {
    setPhase({ step: 'working' });
    const { error } = await supabase.rpc(action.rpc as string, action.args);
    if (error) { setPhase({ step: 'failed', reason: signFailure(error) }); return; }
    setPhase({ step: 'done' });
    onSigned?.();
  };

  return <div className="job-sign" role="group" aria-label={title}>
    <Text role="label">{title}</Text>
    {phase.step === 'idle' && (
      <button type="button" className="job-button" onClick={() => setPhase({ step: 'confirming' })}>
        <Text role="label">Review and sign</Text>
      </button>
    )}
    {(phase.step === 'confirming' || phase.step === 'working' || phase.step === 'failed') && (
      <div className="job-sign__terms">
        <Text role="label" as="h3">Signing says</Text>
        <ul className="job-list">{says.map(s => <li key={s}><Text role="body">{s}</Text></li>)}</ul>
        <Text role="label" as="h3">It does not say</Text>
        <ul className="job-list">{doesNotSay.map(s => <li key={s}><Text role="body">{s}</Text></li>)}</ul>
        <div role="alert" className="jb-live">{phase.step === 'failed' && <Text role="body" as="p" className="job-sign__failure">{phase.reason}</Text>}</div>
        <div className="job-sign__buttons">
          <button type="button" className="job-button job-button--primary" disabled={phase.step === 'working'} onClick={sign}>
            <Text role="label">{phase.step === 'working' ? 'Signing…' : `Sign: ${title}`}</Text>
          </button>
          <button type="button" className="job-button" disabled={phase.step === 'working'} onClick={() => setPhase({ step: 'idle' })}>
            <Text role="label">Cancel</Text>
          </button>
        </div>
      </div>
    )}
    <div role="status" className="jb-live">{phase.step === 'done' && <Text role="caption">Signed. The job below is reloaded from the record.</Text>}</div>
  </div>;
}

/** Every action in a list, or nothing. */
export function SignActions({ actions, onSigned }: { actions: JobAction[]; onSigned?: () => void }) {
  if (actions.length === 0) return null;
  return <div className="job-signs">{actions.map((a, i) => <SignAction key={`${a.kind}-${i}`} action={a} onSigned={onSigned} />)}</div>;
}
