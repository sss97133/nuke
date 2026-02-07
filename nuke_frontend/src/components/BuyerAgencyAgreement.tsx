import React, { useRef, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import {
  COMMISSION_TIERS,
  type CommissionTier,
  formatCommissionRate,
  formatCurrencyFromCents,
  getCommissionRate,
  getCommissionTier,
} from '../utils/commission';
import '../design-system.css';

interface BuyerAgencyAgreementProps {
  onComplete?: (agreementId: string) => void;
  onCancel?: () => void;
}

interface AgreementData {
  id: string;
  status: string;
  commission_rate: number;
  max_authorized_bid_cents: number | null;
  legal_name: string;
  legal_address: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  } | null;
  signed_at: string | null;
}

export default function BuyerAgencyAgreement({ onComplete, onCancel }: BuyerAgencyAgreementProps) {
  const { user } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [step, setStep] = useState<'terms' | 'details' | 'sign'>('terms');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingAgreement, setExistingAgreement] = useState<AgreementData | null>(null);

  // Form fields
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [legalName, setLegalName] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [country, setCountry] = useState('United States');
  const [maxBidAmount, setMaxBidAmount] = useState<string>('');

  const parsedMaxBidAmount = maxBidAmount.trim() ? parseFloat(maxBidAmount) : 0;
  const maxBidCents =
    Number.isFinite(parsedMaxBidAmount) && parsedMaxBidAmount > 0
      ? Math.round(parsedMaxBidAmount * 100)
      : null;
  const commissionTier = getCommissionTier(maxBidCents);
  const commissionRate = getCommissionRate(maxBidCents);
  const commissionRateDisplay = formatCommissionRate(commissionRate);
  const commissionRateRounded = Number(commissionRate.toFixed(2));

  const formatTierRange = (tier: CommissionTier, index: number) => {
    if (index === 0 && tier.maxCents !== null) {
      return `Up to ${formatCurrencyFromCents(tier.maxCents)}`;
    }

    const previousMax = COMMISSION_TIERS[index - 1]?.maxCents ?? null;
    if (tier.maxCents === null) {
      return `Over ${formatCurrencyFromCents(previousMax || 0)}`;
    }

    return `Over ${formatCurrencyFromCents(previousMax || 0)} up to ${formatCurrencyFromCents(
      tier.maxCents,
    )}`;
  };

  // Signature state
  const [isDrawing, setIsDrawing] = useState(false);
  const [signatureExists, setSignatureExists] = useState(false);
  const [lastX, setLastX] = useState(0);
  const [lastY, setLastY] = useState(0);

  const formatError = (err: any, fallback: string) => {
    if (!err) return fallback;
    if (typeof err === 'string') return err;
    const message = err.message || err.error_description || fallback;
    const details = err.details ? ` (${err.details})` : '';
    const hint = err.hint ? ` ${err.hint}` : '';
    return `${message}${details}${hint}`.trim();
  };

  // Load existing agreement
  useEffect(() => {
    if (!user) return;

    const loadExisting = async () => {
      const { data, error } = await supabase
        .from('buyer_agency_agreements')
        .select('*')
        .eq('user_id', user.id)
        .in('status', ['draft', 'pending_signature', 'active'])
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (data && !error) {
        if (data.status === 'active') {
          // Already have active agreement
          onComplete?.(data.id);
          return;
        }

        setExistingAgreement(data);
        setLegalName(data.legal_name || '');
        if (data.legal_address) {
          setStreet(data.legal_address.street || '');
          setCity(data.legal_address.city || '');
          setState(data.legal_address.state || '');
          setZip(data.legal_address.zip || '');
          setCountry(data.legal_address.country || 'United States');
        }
        if (data.max_authorized_bid_cents) {
          setMaxBidAmount((data.max_authorized_bid_cents / 100).toString());
        }

        setTermsAccepted(true);
        if (data.status === 'pending_signature') {
          setStep('sign');
        } else if (data.status === 'draft') {
          setStep('details');
        }
      }
    };

    loadExisting();
  }, [user]);

  // Initialize signature canvas
  useEffect(() => {
    if (step !== 'sign') return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = 400;
    canvas.height = 150;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(20, canvas.height - 20);
    ctx.lineTo(canvas.width - 20, canvas.height - 20);
    ctx.stroke();

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, [step]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    setLastX(clientX - rect.left);
    setLastY(clientY - rect.top);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const currentX = clientX - rect.left;
    const currentY = clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(currentX, currentY);
    ctx.stroke();

    setLastX(currentX);
    setLastY(currentY);
    setSignatureExists(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(20, canvas.height - 20);
    ctx.lineTo(canvas.width - 20, canvas.height - 20);
    ctx.stroke();

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;

    setSignatureExists(false);
  };

  const handleAcceptTerms = () => {
    if (termsAccepted) {
      setStep('details');
    }
  };

  const handleSaveDetails = async () => {
    if (!user) return;
    if (!legalName.trim()) {
      setError('Legal name is required');
      return;
    }

    const trimmedMaxBidAmount = maxBidAmount.trim();
    if (trimmedMaxBidAmount && maxBidCents === null) {
      setError('Maximum bid must be a positive number or left blank');
      return;
    }

    const hasAddress = [street, city, state, zip].some((value) => value.trim());
    const legalAddress = hasAddress ? {
      street: street.trim(),
      city: city.trim(),
      state: state.trim(),
      zip: zip.trim(),
      country: country.trim(),
    } : null;

    setLoading(true);
    setError(null);

    try {
      const agreementData = {
        user_id: user.id,
        status: 'pending_signature',
        legal_name: legalName.trim(),
        legal_address: legalAddress,
        max_authorized_bid_cents: maxBidCents,
        commission_rate: commissionRateRounded,
      };

      let result;
      if (existingAgreement?.id) {
        result = await supabase
          .from('buyer_agency_agreements')
          .update(agreementData)
          .eq('id', existingAgreement.id)
          .select()
          .single();
      } else {
        result = await supabase
          .from('buyer_agency_agreements')
          .insert(agreementData)
          .select()
          .single();
      }

      if (result.error) throw result.error;

      setExistingAgreement(result.data);
      setStep('sign');
    } catch (err: any) {
      console.error('Failed to save agreement:', err);
      setError(formatError(err, 'Failed to save agreement'));
    } finally {
      setLoading(false);
    }
  };

  const handleSign = async () => {
    if (!user || !existingAgreement || !signatureExists) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    setLoading(true);
    setError(null);

    try {
      const imageData = canvas.toDataURL('image/png');

      const { error: updateError } = await supabase
        .from('buyer_agency_agreements')
        .update({
          status: 'active',
          signature_data: {
            image: imageData,
            timestamp: new Date().toISOString(),
            signerName: legalName,
          },
          signed_at: new Date().toISOString(),
        })
        .eq('id', existingAgreement.id);

      if (updateError) throw updateError;

      onComplete?.(existingAgreement.id);
    } catch (err: any) {
      console.error('Failed to sign agreement:', err);
      setError(formatError(err, 'Failed to sign agreement'));
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="card">
        <div className="card-body text-center">
          <p>Please log in to create a buyer agency agreement.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: '700px', margin: '0 auto' }}>
      <div className="card-header">
        <h2 style={{ margin: 0, fontSize: '12pt', fontWeight: 700 }}>Buyer Agency Agreement</h2>
        <p style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
          Authorize N-Zero to bid on your behalf at external auctions
        </p>
      </div>

      <div className="card-body">
        {error && (
          <div style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            padding: '10px 12px',
            borderRadius: '4px',
            marginBottom: '16px',
            fontSize: '9pt'
          }}>
            {error}
          </div>
        )}

        {/* Step indicators */}
        <div style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '20px',
          fontSize: '8pt'
        }}>
          {['terms', 'details', 'sign'].map((s, i) => (
            <div key={s} style={{
              flex: 1,
              padding: '8px',
              textAlign: 'center',
              borderRadius: '4px',
              background: step === s ? 'var(--accent-dim)' : 'var(--surface-hover)',
              color: step === s ? 'var(--accent)' : 'var(--text-muted)',
              fontWeight: step === s ? 700 : 400,
            }}>
              {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
            </div>
          ))}
        </div>

        {/* Step 1: Terms */}
        {step === 'terms' && (
          <div>
            <div style={{
              background: 'var(--surface-hover)',
              padding: '16px',
              borderRadius: '4px',
              maxHeight: '400px',
              overflowY: 'auto',
              fontSize: '9pt',
              lineHeight: '1.6',
              marginBottom: '16px'
            }}>
              <h3 style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '12px' }}>
                N-ZERO BUYER AGENCY AGREEMENT
              </h3>

              <p><strong>1. Appointment as Agent</strong></p>
              <p style={{ marginBottom: '12px' }}>
                By signing this agreement, you ("Buyer") appoint N-Zero ("Agent") as your exclusive
                buyer's agent for the purpose of bidding on and purchasing vehicles at external
                auction platforms including but not limited to Bring a Trailer, Cars & Bids,
                RM Sotheby's, Gooding & Company, and other online and in-person auctions.
              </p>

              <p><strong>2. Agent's Duties</strong></p>
              <p style={{ marginBottom: '12px' }}>
                Agent agrees to: (a) bid on vehicles specified by Buyer up to the maximum
                authorized bid amount; (b) provide updates on bid status; (c) facilitate payment
                and delivery arrangements upon winning bid; (d) maintain confidentiality of
                Buyer's maximum bid amounts and bidding strategy.
              </p>

              <p><strong>3. Commission (Risk-Adjusted)</strong></p>
              <p style={{ marginBottom: '12px' }}>
                Buyer agrees to pay Agent a risk-adjusted commission based on the final hammer price
                for any vehicle successfully purchased through Agent's services. Rates are tiered by
                value to reflect handling risk and required coverage:
              </p>
              <ul style={{ paddingLeft: '18px', marginBottom: '12px' }}>
                {COMMISSION_TIERS.map((tier, index) => (
                  <li key={tier.label} style={{ marginBottom: '6px' }}>
                    <strong>{tier.label}</strong> ({formatTierRange(tier, index)}):{' '}
                    {formatCommissionRate(tier.rate)}%
                    <span style={{ color: 'var(--text-muted)' }}> — {tier.description}</span>
                  </li>
                ))}
              </ul>
              <p style={{ marginBottom: '12px' }}>
                Commission is due upon successful completion of the purchase transaction. The exact
                rate is determined by the final hammer price if the bid is successful.
              </p>

              <p><strong>4. Deposit Authorization</strong></p>
              <p style={{ marginBottom: '12px' }}>
                Buyer authorizes Agent to collect a refundable deposit of 10% of the maximum
                bid amount prior to placing bids. This deposit will be applied toward the
                commission upon successful purchase, or fully refunded if the bid is unsuccessful.
              </p>

              <p><strong>5. Buyer's Responsibilities</strong></p>
              <p style={{ marginBottom: '12px' }}>
                Buyer agrees to: (a) provide accurate bidding instructions; (b) maintain
                sufficient funds to complete authorized purchases; (c) complete purchase
                transactions within the auction's required timeframe; (d) pay all applicable
                buyer's premiums, taxes, and fees directly to the auction house.
              </p>

              <p><strong>6. No Guarantees</strong></p>
              <p style={{ marginBottom: '12px' }}>
                Agent does not guarantee that Buyer will win any auction. Agent will use
                reasonable efforts to place bids according to Buyer's instructions but is not
                liable for missed bids due to technical issues, auction house policies, or
                other circumstances beyond Agent's control.
              </p>

              <p><strong>7. Term</strong></p>
              <p style={{ marginBottom: '12px' }}>
                This agreement is effective upon signing and remains in effect for one (1) year,
                unless terminated earlier by either party with 30 days written notice.
              </p>

              <p><strong>8. Governing Law</strong></p>
              <p>
                This agreement shall be governed by and construed in accordance with the
                laws of the State of California.
              </p>
            </div>

            <label style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              marginBottom: '16px',
              cursor: 'pointer'
            }}>
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                style={{ marginTop: '2px' }}
              />
              <span style={{ fontSize: '9pt' }}>
                I have read and agree to the terms and conditions of this Buyer Agency Agreement.
                I understand that N-Zero will act as my agent for bidding on external auctions
                and that I am responsible for a risk-adjusted commission based on the schedule above.
              </span>
            </label>

            <div style={{ display: 'flex', gap: '12px' }}>
              {onCancel && (
                <button
                  type="button"
                  className="button"
                  onClick={onCancel}
                  style={{ fontSize: '9pt' }}
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                className="button button-primary"
                onClick={handleAcceptTerms}
                disabled={!termsAccepted}
                style={{ fontSize: '9pt' }}
              >
                Accept & Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Personal Details */}
        {step === 'details' && (
          <div>
            <p style={{ fontSize: '9pt', marginBottom: '16px', color: 'var(--text-secondary)' }}>
              Please provide your legal information for the agreement.
            </p>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '8pt', fontWeight: 600, marginBottom: '4px' }}>
                Legal Full Name *
              </label>
              <input
                type="text"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="As it appears on your ID"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  border: '1px solid var(--border)',
                  fontSize: '9pt'
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '8pt', fontWeight: 600, marginBottom: '4px' }}>
                Street Address
              </label>
              <input
                type="text"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                placeholder="123 Main Street"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  border: '1px solid var(--border)',
                  fontSize: '9pt'
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '8pt', fontWeight: 600, marginBottom: '4px' }}>
                  City
                </label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    border: '1px solid var(--border)',
                    fontSize: '9pt'
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '8pt', fontWeight: 600, marginBottom: '4px' }}>
                  State
                </label>
                <input
                  type="text"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    border: '1px solid var(--border)',
                    fontSize: '9pt'
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '8pt', fontWeight: 600, marginBottom: '4px' }}>
                  ZIP
                </label>
                <input
                  type="text"
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    border: '1px solid var(--border)',
                    fontSize: '9pt'
                  }}
                />
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '8pt', fontWeight: 600, marginBottom: '4px' }}>
                Maximum Authorized Bid (Optional)
              </label>
              <div style={{ position: 'relative' }}>
                <span style={{
                  position: 'absolute',
                  left: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: '9pt',
                  color: 'var(--text-muted)'
                }}>$</span>
                <input
                  type="number"
                  value={maxBidAmount}
                  onChange={(e) => setMaxBidAmount(e.target.value)}
                  placeholder="No limit"
                  style={{
                    width: '100%',
                    padding: '8px 10px 8px 20px',
                    border: '1px solid var(--border)',
                    fontSize: '9pt'
                  }}
                />
              </div>
              <p style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '4px' }}>
                Leave blank for no maximum limit. You can set limits per-bid later.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                type="button"
                className="button"
                onClick={() => setStep('terms')}
                style={{ fontSize: '9pt' }}
              >
                Back
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={handleSaveDetails}
                disabled={loading || !legalName.trim()}
                style={{ fontSize: '9pt' }}
              >
                {loading ? 'Saving...' : 'Continue to Sign'}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Signature */}
        {step === 'sign' && (
          <div>
            <p style={{ fontSize: '9pt', marginBottom: '16px', color: 'var(--text-secondary)' }}>
              Please sign below to complete the agreement.
            </p>

            <div style={{
              background: 'var(--surface-hover)',
              padding: '12px',
              borderRadius: '4px',
              marginBottom: '16px',
              fontSize: '8pt'
            }}>
              <p><strong>Signer:</strong> {legalName}</p>
              <p><strong>Commission Schedule:</strong> Risk-adjusted by value tier</p>
              {maxBidAmount && (
                <p>
                  <strong>Estimated Rate (based on max authorized bid):</strong>{' '}
                  {commissionRateDisplay}% ({commissionTier.label})
                </p>
              )}
              {maxBidAmount && (
                <p><strong>Max Authorized Bid:</strong> ${parseFloat(maxBidAmount).toLocaleString()}</p>
              )}
              <p><strong>Date:</strong> {new Date().toLocaleDateString()}</p>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '8pt', fontWeight: 600, marginBottom: '8px' }}>
                Sign in the area below:
              </label>
              <div style={{
                border: '2px solid var(--border)',
                borderRadius: '4px',
                overflow: 'hidden',
                display: 'inline-block'
              }}>
                <canvas
                  ref={canvasRef}
                  style={{ display: 'block', cursor: 'crosshair', touchAction: 'none' }}
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  onTouchStart={startDrawing}
                  onTouchMove={draw}
                  onTouchEnd={stopDrawing}
                />
              </div>
              <p style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '4px' }}>
                Use your mouse or touch screen to sign above
              </p>
            </div>

            <p style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '16px' }}>
              By signing above, I acknowledge that I have read and agree to all terms and conditions
              of this Buyer Agency Agreement. This electronic signature has the same legal effect
              as a handwritten signature.
            </p>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                type="button"
                className="button"
                onClick={() => setStep('details')}
                style={{ fontSize: '9pt' }}
              >
                Back
              </button>
              <button
                type="button"
                className="button"
                onClick={clearSignature}
                disabled={!signatureExists}
                style={{ fontSize: '9pt' }}
              >
                Clear
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={handleSign}
                disabled={loading || !signatureExists}
                style={{ fontSize: '9pt' }}
              >
                {loading ? 'Signing...' : 'Sign & Complete Agreement'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
