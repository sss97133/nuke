import React from 'react';
import { CircularAvatar } from '../../components/common/CircularAvatar';
import type { DealJacket } from './hooks/useBuildStatus';

interface Props {
  dealJacket: DealJacket;
  isOwnerView: boolean;
}

const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtDate = (d: string) => {
  const date = new Date(d + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const OwnerIdentityCard: React.FC<Props> = ({ dealJacket, isOwnerView }) => {
  const contact = dealJacket.contact;
  if (!contact) return null;

  const initial = contact.full_name?.charAt(0) || '?';

  return (
    <div style={{
      border: '2px solid var(--vp-ink)',
      padding: '10px 16px',
      fontFamily: 'var(--vp-font-sans)',
    }}>
      {/* Identity row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
        <CircularAvatar
          src={contact.profile_image_url}
          alt={contact.full_name}
          size={36}
          fallback={initial}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              fontSize: '11px',
              fontWeight: 700,
              fontFamily: 'var(--vp-font-mono)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              {contact.full_name}
            </span>
            <span style={{
              display: 'inline-block',
              padding: '1px 4px',
              fontSize: '7px',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              border: '1px solid var(--vp-brg)',
              color: 'var(--vp-brg)',
              fontFamily: 'var(--vp-font-mono)',
            }}>
              OWNER
            </span>
          </div>
          <div style={{
            fontSize: '8px',
            color: 'var(--vp-pencil)',
            marginTop: '2px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {contact.email}
            {contact.email && contact.phone_mobile && ' \u00B7 '}
            {contact.phone_mobile}
          </div>
        </div>
      </div>

      {/* Address — owner/contributor only */}
      {isOwnerView && contact.address && (
        <div style={{
          fontSize: '8px',
          color: 'var(--vp-pencil)',
          marginBottom: '8px',
          letterSpacing: '0.02em',
        }}>
          {contact.address}
          {contact.city && `, ${contact.city}`}
          {contact.state && `, ${contact.state}`}
          {contact.zip && ` ${contact.zip}`}
        </div>
      )}

      {/* Sale grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2px' }}>
        {dealJacket.sale_price_inc_doc != null && (
          <div style={{ border: '2px solid var(--vp-border)', padding: '6px 8px' }}>
            <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>SALE PRICE</div>
            <div style={{ fontFamily: 'var(--vp-font-mono)', fontSize: '11px', fontWeight: 700 }}>{fmt(dealJacket.sale_price_inc_doc)}</div>
          </div>
        )}
        {dealJacket.sold_date && (
          <div style={{ border: '2px solid var(--vp-border)', padding: '6px 8px' }}>
            <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>SOLD</div>
            <div style={{ fontFamily: 'var(--vp-font-mono)', fontSize: '11px', fontWeight: 700 }}>{fmtDate(dealJacket.sold_date)}</div>
          </div>
        )}
        {dealJacket.deposit_amount != null && dealJacket.deposit_amount > 0 && (
          <div style={{ border: '2px solid var(--vp-border)', padding: '6px 8px' }}>
            <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>DEPOSIT</div>
            <div style={{ fontFamily: 'var(--vp-font-mono)', fontSize: '11px', fontWeight: 700 }}>{fmt(dealJacket.deposit_amount)}</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OwnerIdentityCard;
