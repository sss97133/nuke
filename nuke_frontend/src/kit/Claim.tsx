import React, { useRef, useState } from 'react';
import { HeaderPopover } from '../components/vehicle/HeaderPopover';
import type { Claim, Role } from './types';
import { Text } from './Text';
import { day } from './format';

const SOURCE_KIND_LABEL: Record<Claim['source']['kind'], string> = {
  listing: 'Listing',
  owner: 'Owner',
  image: 'Image',
  document: 'Document',
  agent: 'Agent',
  model: 'Model',
  legacy: 'Legacy record',
};

/** The evidence behind a claim: when it was observed, who said it, how far it is trusted, where to read it. */
export function SourceView({ claim }: { claim: Claim }) {
  const url = claim.source.url && /^https?:\/\//i.test(claim.source.url) ? claim.source.url : null;
  return <div className="k-claim__source">
    <p><Text role="label">Observed</Text><Text role="body">{day(claim.observed_at)}</Text></p>
    <p><Text role="label">Source</Text><Text role="body">{claim.source.label ?? SOURCE_KIND_LABEL[claim.source.kind]}{claim.source.method ? ` · ${claim.source.method}` : ''}</Text></p>
    <p><Text role="label">Trust</Text><Text role="body">{Math.round(Math.min(1, Math.max(0, claim.trust)) * 100)}%</Text></p>
    {url && <p><a className="k-body" href={url} target="_blank" rel="noreferrer">Open source ↗</a></p>}
  </div>;
}

type ClaimViewProps = {
  claim: Claim;
  label?: string;
  role?: Role;
  format?: (value: Claim['value']) => string;
};

/** A fact on the page. Its value is a button into its evidence; it cannot render without a source. */
export function ClaimView({ claim, label, role = 'measure', format }: ClaimViewProps) {
  const [open, setOpen] = useState(false);
  const boundary = useRef<HTMLSpanElement>(null);
  const text = format ? format(claim.value) : String(claim.value);
  return <span ref={boundary} className="k-claim">
    {label && <Text role="label">{label}</Text>}
    <button type="button" className="k-claim__value" aria-haspopup="dialog" aria-expanded={open}
      aria-label={`Inspect the source of ${label ?? text}`} onClick={() => setOpen(value => !value)}>
      <Text role={role}>{text}</Text>
    </button>
    <HeaderPopover open={open} title="Source" width={300} align="right" dismissBoundaryRef={boundary} onClose={() => setOpen(false)}>
      <SourceView claim={claim} />
    </HeaderPopover>
  </span>;
}
