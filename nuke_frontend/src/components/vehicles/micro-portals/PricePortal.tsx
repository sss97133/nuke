import React, { useState, useCallback } from 'react';
import MicroPortal from './MicroPortal';
import { formatCurrencyAmount } from '../../../utils/currency';
import { supabase } from '../../../lib/supabase';

/**
 * PricePortal — click the price to see price waterfall context.
 *
 * Shows MSRP -> purchase -> asking -> sold waterfall,
 * deal score context, nuke estimate vs actual.
 *
 * Key change: "No price data" is gone. Price row always shows SOMETHING.
 * When truly empty, shows an invitation to add MSRP with a save form.
 */

interface PricePortalProps {
  vehicle: {
    id?: string;
    sale_price?: number;
    asking_price?: number;
    current_value?: number;
    display_price?: number;
    msrp?: number;
    original_msrp?: number;
    nuke_estimate?: number;
    nuke_estimate_confidence?: number;
    deal_score?: number;
    deal_score_label?: string;
  };
  vehicleId?: string;
  userId?: string;
  activePortal: string | null;
  onOpen: (id: string | null) => void;
}

export default function PricePortal({ vehicle, vehicleId, userId, activePortal, onOpen }: PricePortalProps) {
  const v = vehicle;
  const resolvedVehicleId = vehicleId || v.id;
  const msrp = v.msrp || v.original_msrp;
  const salePrice = v.sale_price;
  const askingPrice = v.asking_price;
  const estimate = v.nuke_estimate;
  const anyPrice = salePrice || askingPrice || v.current_value || v.display_price;
  const hasData = !!(msrp || anyPrice || estimate);

  // MSRP input form state
  const [showMsrpForm, setShowMsrpForm] = useState(false);
  const [msrpInput, setMsrpInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMsrp, setSavedMsrp] = useState<number | null>(null);

  const handleSaveMsrp = useCallback(async () => {
    const parsed = parseInt(msrpInput.replace(/[,$\s]/g, ''), 10);
    if (!parsed || parsed < 100 || parsed > 10_000_000) {
      setSaveError('Enter a valid MSRP ($100 - $10M)');
      return;
    }
    if (!resolvedVehicleId) {
      setSaveError('No vehicle ID');
      return;
    }

    setSaving(true);
    setSaveError(null);

    const { error } = await supabase
      .from('vehicles')
      .update({
        msrp: parsed,
        msrp_source: 'user',
        msrp_contributed_by: userId || null,
      })
      .eq('id', resolvedVehicleId);

    setSaving(false);

    if (error) {
      setSaveError(error.message);
      return;
    }

    setSavedMsrp(parsed);
    setShowMsrpForm(false);
    setMsrpInput('');
  }, [msrpInput, resolvedVehicleId, userId]);

  const displayMsrp = savedMsrp || msrp;

  // Determine the trigger display
  const triggerContent = anyPrice ? (
    <span style={{ fontSize: '19px', fontWeight: 700, color: 'var(--text)' }}>
      {formatCurrencyAmount(anyPrice)}
    </span>
  ) : estimate ? (
    <span style={{ fontSize: '19px', fontWeight: 700, color: 'var(--text-muted)' }}>
      ~{formatCurrencyAmount(estimate)}
    </span>
  ) : displayMsrp ? (
    <span style={{ fontSize: '19px', fontWeight: 700, color: 'var(--text-muted)' }}>
      MSRP {formatCurrencyAmount(displayMsrp)}
    </span>
  ) : (
    <span style={{ color: 'var(--primary, #3b82f6)', fontSize: '13px', fontWeight: 500 }}>
      + Add price
    </span>
  );

  return (
    <MicroPortal
      portalId="price"
      activePortal={activePortal}
      onOpen={onOpen}
      trigger={triggerContent}
      width={260}
    >
      <div style={{ padding: '10px 12px' }}>
        <div style={{
          fontSize: '9px', fontWeight: 700, color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px',
        }}>
          Price Intelligence
        </div>

        {!hasData && !savedMsrp ? (
          /* Empty state — MSRP input form */
          <div style={{ padding: '8px 0' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' }}>
              No price data yet. Add MSRP to unlock deal scoring and market comparison.
            </div>

            {showMsrpForm ? (
              <div>
                <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: '28px' }}>$</span>
                  <input
                    type="text"
                    value={msrpInput}
                    onChange={(e) => {
                      setSaveError(null);
                      setMsrpInput(e.target.value);
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveMsrp(); }}
                    placeholder="e.g. 52,000"
                    autoFocus
                    style={{
                      flex: 1,
                      padding: '4px 6px',
                      fontSize: '12px',
                      border: '1px solid var(--border)', background: 'var(--bg, #fff)',
                      color: 'var(--text)',
                      outline: 'none',
                      minWidth: 0,
                    }}
                  />
                  <button
                    onClick={handleSaveMsrp}
                    disabled={saving || !msrpInput.trim()}
                    style={{
                      padding: '4px 8px',
                      fontSize: '11px',
                      fontWeight: 600,
                      background: saving ? 'var(--border)' : 'var(--primary, #3b82f6)',
                      color: 'var(--bg)',
                      border: 'none', cursor: saving ? 'wait' : 'pointer',
                      opacity: !msrpInput.trim() ? 0.5 : 1,
                    }}
                  >
                    {saving ? '...' : 'Save'}
                  </button>
                </div>
                {saveError && (
                  <div style={{ fontSize: '9px', color: 'var(--error)', marginTop: '2px' }}>{saveError}</div>
                )}
                <button
                  onClick={() => { setShowMsrpForm(false); setMsrpInput(''); setSaveError(null); }}
                  style={{
                    background: 'none', border: 'none', fontSize: '9px',
                    color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 0',
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div
                onClick={() => setShowMsrpForm(true)}
                style={{
                  padding: '6px 8px',
                  border: '1px dashed var(--border)', fontSize: '11px',
                  color: 'var(--primary, #3b82f6)',
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                + Add MSRP
              </div>
            )}
          </div>
        ) : (
          /* Price waterfall */
          <div>
            {(displayMsrp ?? 0) > 0 && (
              <WaterfallRow label="MSRP" value={formatCurrencyAmount(displayMsrp!)} muted />
            )}
            {askingPrice && askingPrice > 0 && (
              <WaterfallRow label="Asking" value={formatCurrencyAmount(askingPrice)} />
            )}
            {salePrice && salePrice > 0 && (
              <WaterfallRow label="Sold" value={formatCurrencyAmount(salePrice)} bold />
            )}
            {estimate && estimate > 0 && (
              <WaterfallRow
                label="Nuke Est."
                value={formatCurrencyAmount(estimate)}
                suffix={v.nuke_estimate_confidence ? `${v.nuke_estimate_confidence}% conf` : undefined}
              />
            )}

            {/* Deal score context */}
            {v.deal_score != null && anyPrice && estimate && (
              <div style={{
                marginTop: '8px', padding: '6px 8px',
                background: 'var(--bg-secondary, #f3f4f6)', }}>
                <DealScore score={v.deal_score} price={anyPrice} estimate={estimate} />
              </div>
            )}

            {/* Depreciation from MSRP */}
            {displayMsrp && displayMsrp > 0 && anyPrice && anyPrice > 0 && (
              <div style={{ marginTop: '6px', fontSize: '9px', color: 'var(--text-muted)' }}>
                {anyPrice < displayMsrp
                  ? `${Math.round(((displayMsrp - anyPrice) / displayMsrp) * 100)}% below MSRP`
                  : anyPrice > displayMsrp
                  ? `${Math.round(((anyPrice - displayMsrp) / displayMsrp) * 100)}% above MSRP (appreciation)`
                  : 'At MSRP'
                }
              </div>
            )}

            {/* Add MSRP inline if missing — even in waterfall view */}
            {!displayMsrp && resolvedVehicleId && (
              <div style={{ marginTop: '8px' }}>
                {showMsrpForm ? (
                  <div>
                    <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: '28px' }}>$</span>
                      <input
                        type="text"
                        value={msrpInput}
                        onChange={(e) => { setSaveError(null); setMsrpInput(e.target.value); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSaveMsrp(); }}
                        placeholder="MSRP"
                        autoFocus
                        style={{
                          flex: 1, padding: '4px 6px', fontSize: '12px',
                          border: '1px solid var(--border)', background: 'var(--bg, #fff)', color: 'var(--text)',
                          outline: 'none', minWidth: 0,
                        }}
                      />
                      <button
                        onClick={handleSaveMsrp}
                        disabled={saving || !msrpInput.trim()}
                        style={{
                          padding: '4px 8px', fontSize: '11px', fontWeight: 600,
                          background: saving ? 'var(--border)' : 'var(--primary, #3b82f6)',
                          color: 'var(--bg)', border: 'none', cursor: saving ? 'wait' : 'pointer',
                          opacity: !msrpInput.trim() ? 0.5 : 1,
                        }}
                      >
                        {saving ? '...' : 'Save'}
                      </button>
                    </div>
                    {saveError && (
                      <div style={{ fontSize: '9px', color: 'var(--error)', marginTop: '2px' }}>{saveError}</div>
                    )}
                  </div>
                ) : (
                  <div
                    onClick={() => setShowMsrpForm(true)}
                    style={{
                      padding: '4px 6px', fontSize: '9px',
                      color: 'var(--primary, #3b82f6)', cursor: 'pointer',
                      borderTop: '1px solid var(--border)', paddingTop: '6px',
                    }}
                  >
                    + Add original MSRP
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </MicroPortal>
  );
}

function WaterfallRow({ label, value, bold, muted, suffix }: {
  label: string; value: string; bold?: boolean; muted?: boolean; suffix?: string;
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '3px 0',
      borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ color: 'var(--text-muted)', fontSize: '9px' }}>{label}</span>
      <span style={{
        fontWeight: bold ? 700 : 500,
        color: muted ? 'var(--text-muted)' : 'var(--text)',
      }}>
        {value}
        {suffix && <span style={{ fontSize: '9px', color: 'var(--text-muted)', marginLeft: '4px' }}>{suffix}</span>}
      </span>
    </div>
  );
}

function DealScore({ score, price, estimate }: { score: number; price: number; estimate: number }) {
  const pctDiff = Math.round(((estimate - price) / estimate) * 100);
  const isGoodDeal = score > 20;
  const isFair = score > 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}>
      <span style={{
        width: '6px', height: '6px', flexShrink: 0,
        background: isGoodDeal ? 'var(--success)' : isFair ? 'var(--success)' : score > -20 ? 'var(--warning)' : 'var(--error)',
      }} />
      <span>
        {isGoodDeal ? `Good deal — ${Math.abs(pctDiff)}% below estimate` :
         isFair ? 'Fair price — near market value' :
         score > -20 ? 'Slightly above market' :
         `${Math.abs(pctDiff)}% above estimate`}
      </span>
    </div>
  );
}
