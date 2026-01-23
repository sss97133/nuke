import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import BuyerAgencyAgreement from './BuyerAgencyAgreement';
import { PlatformCredentialForm } from './bidding';
import {
  calculateCommissionCents,
  formatCommissionRate,
  getCommissionRate,
  getCommissionTier,
} from '../utils/commission';
import '../design-system.css';

interface ProxyBidModalProps {
  isOpen: boolean;
  onClose: () => void;
  listing: {
    id: string;
    vehicle_id: string;
    platform: string;
    listing_url: string;
    current_bid_cents: number | null;
    vehicle: {
      year: number;
      make: string;
      model: string;
      primary_image_url?: string | null;
    };
  };
  onBidPlaced?: (bidId: string) => void;
}

export default function ProxyBidModal({ isOpen, onClose, listing, onBidPlaced }: ProxyBidModalProps) {
  const { user } = useAuth();
  const [step, setStep] = useState<'check' | 'credentials' | 'agreement' | 'bid' | 'confirm' | 'success'>('check');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [hasActiveAgreement, setHasActiveAgreement] = useState(false);
  const [agreementId, setAgreementId] = useState<string | null>(null);
  const [hasPlatformCredentials, setHasPlatformCredentials] = useState(false);
  const [showCredentialForm, setShowCredentialForm] = useState(false);

  // Bid form
  const [maxBid, setMaxBid] = useState<string>('');
  const [bidStrategy, setBidStrategy] = useState<'proxy_auto' | 'snipe_last_minute'>('proxy_auto');
  const [agreedToDeposit, setAgreedToDeposit] = useState(false);

  const currentBid = listing.current_bid_cents ? listing.current_bid_cents / 100 : 0;
  const minBid = currentBid > 0 ? currentBid + 100 : 1000; // Minimum $100 increment or $1000 start
  const trimmedMaxBid = maxBid.trim();
  const parsedMaxBid = trimmedMaxBid ? parseFloat(trimmedMaxBid) : 0;
  const maxBidAmount = Number.isFinite(parsedMaxBid) ? parsedMaxBid : 0;
  const maxBidCents = maxBidAmount > 0 ? Math.round(maxBidAmount * 100) : 0;
  const depositCents = maxBidCents ? Math.round(maxBidCents * 0.1) : 0;
  const depositAmount = depositCents / 100;
  const commissionRate = getCommissionRate(maxBidCents);
  const commissionRateDisplay = formatCommissionRate(commissionRate);
  const commissionTier = getCommissionTier(maxBidCents);
  const commissionCents = calculateCommissionCents(maxBidCents);
  const commissionAmount = commissionCents / 100;
  const commissionRateRounded = Number(commissionRate.toFixed(2));

  // Check for existing agreement and platform credentials
  useEffect(() => {
    if (!isOpen || !user) return;

    const checkRequirements = async () => {
      setLoading(true);
      try {
        // Check for platform credentials (for automated bidding)
        const { data: credData } = await supabase
          .from('platform_credentials')
          .select('id, status')
          .eq('user_id', user.id)
          .eq('platform', listing.platform)
          .eq('status', 'active')
          .limit(1)
          .single();

        const hasCredentials = !!credData;
        setHasPlatformCredentials(hasCredentials);

        // Check for buyer agency agreement
        const { data: agreementData } = await supabase
          .from('buyer_agency_agreements')
          .select('id')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .gte('expiration_date', new Date().toISOString().split('T')[0])
          .limit(1)
          .single();

        if (agreementData) {
          setHasActiveAgreement(true);
          setAgreementId(agreementData.id);

          // If we have credentials, go to bid step; otherwise prompt for credentials
          if (hasCredentials) {
            setStep('bid');
          } else {
            setStep('credentials');
          }
        } else {
          setHasActiveAgreement(false);
          setStep('agreement');
        }
      } catch (err) {
        setHasActiveAgreement(false);
        setStep('agreement');
      } finally {
        setLoading(false);
      }
    };

    checkRequirements();
  }, [isOpen, user, listing.platform]);

  const handleAgreementComplete = (newAgreementId: string) => {
    setAgreementId(newAgreementId);
    setHasActiveAgreement(true);
    // Check credentials before allowing bid
    if (hasPlatformCredentials) {
      setStep('bid');
    } else {
      setStep('credentials');
    }
  };

  const handleSubmitBid = async () => {
    if (!user || !agreementId) return;

    if (!maxBidCents) {
      setError('Enter a valid maximum bid amount.');
      return;
    }

    if (maxBidCents < minBid * 100) {
      setError(`Minimum bid is $${minBid.toLocaleString()}`);
      return;
    }

    setStep('confirm');
  };

  const handleConfirmBid = async () => {
    if (!user || !agreementId) return;

    if (!maxBidCents) {
      setError('Enter a valid maximum bid amount.');
      return;
    }

    // Verify credentials exist before placing bid
    if (!hasPlatformCredentials) {
      setError('Platform credentials required. Please connect your account first.');
      setStep('credentials');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const depositCents = Math.round(maxBidCents * 0.1);

      // Create proxy bid request
      const { data, error: insertError } = await supabase
        .from('proxy_bid_requests')
        .insert({
          user_id: user.id,
          agency_agreement_id: agreementId,
          external_listing_id: listing.id,
          vehicle_id: listing.vehicle_id,
          platform: listing.platform,
          external_auction_url: listing.listing_url,
          max_bid_cents: maxBidCents,
          bid_strategy: bidStrategy,
          deposit_amount_cents: depositCents,
          deposit_status: 'pending',
          status: 'pending',
          commission_rate: commissionRateRounded,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Create Stripe PaymentIntent for deposit hold
      const { data: session } = await supabase.auth.getSession();
      const depositResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-proxy-bid-deposit`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.session?.access_token}`,
          },
          body: JSON.stringify({ proxy_bid_request_id: data.id }),
        }
      );

      const depositResult = await depositResponse.json();

      if (!depositResult.success) {
        // If deposit authorization fails, update the bid request status
        await supabase
          .from('proxy_bid_requests')
          .update({ status: 'cancelled', deposit_status: 'failed' })
          .eq('id', data.id);

        if (depositResult.requires_payment_method) {
          throw new Error('Please add a payment method to your account before placing a proxy bid.');
        }
        throw new Error(depositResult.error || 'Failed to authorize deposit');
      }

      setStep('success');
      onBidPlaced?.(data.id);
    } catch (err: any) {
      setError(err.message || 'Failed to place bid');
    } finally {
      setLoading(false);
    }
  };

  const getPlatformName = (platform: string) => {
    const names: Record<string, string> = {
      bat: 'Bring a Trailer',
      cars_and_bids: 'Cars & Bids',
      pcarmarket: 'PCarMarket',
      collecting_cars: 'Collecting Cars',
      broad_arrow: 'Broad Arrow',
      rmsothebys: 'RM Sothebys',
      gooding: 'Gooding & Company',
      sbx: 'SBX Cars',
    };
    return names[platform] || platform;
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '20px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          borderRadius: '8px',
          maxWidth: step === 'agreement' ? '750px' : step === 'credentials' ? '450px' : '500px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h2 style={{ margin: 0, fontSize: '12pt', fontWeight: 700 }}>
            {step === 'agreement' ? 'Buyer Agency Agreement' : step === 'credentials' ? 'Add Platform Login' : 'Place Proxy Bid'}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '16pt',
              cursor: 'pointer',
              padding: '0 4px',
              color: 'var(--text-muted)'
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '20px' }}>
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

          {/* Loading state */}
          {step === 'check' && loading && (
            <div style={{ textAlign: 'center', padding: '40px', fontSize: '9pt', color: 'var(--text-muted)' }}>
              Checking your account...
            </div>
          )}

          {/* Agreement step */}
          {step === 'agreement' && (
            <BuyerAgencyAgreement
              onComplete={handleAgreementComplete}
              onCancel={onClose}
            />
          )}

          {/* Credentials step */}
          {step === 'credentials' && (
            <div>
              <div style={{
                background: '#fef3c7',
                border: '1px solid #fcd34d',
                padding: '12px',
                borderRadius: '4px',
                marginBottom: '16px'
              }}>
                <div style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '4px' }}>
                  Platform Login Required
                </div>
                <div style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
                  To bid automatically on {getPlatformName(listing.platform)}, we need your login credentials.
                  Your credentials are encrypted and stored securely.
                </div>
              </div>

              <div style={{
                display: 'flex',
                gap: '12px',
                marginBottom: '16px',
                padding: '12px',
                background: 'var(--surface-hover)',
                borderRadius: '4px'
              }}>
                {listing.vehicle.primary_image_url && (
                  <img
                    src={listing.vehicle.primary_image_url}
                    alt=""
                    style={{
                      width: '80px',
                      height: '60px',
                      objectFit: 'cover',
                      borderRadius: '4px'
                    }}
                  />
                )}
                <div>
                  <div style={{ fontSize: '10pt', fontWeight: 700 }}>
                    {listing.vehicle.year} {listing.vehicle.make} {listing.vehicle.model}
                  </div>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                    on {getPlatformName(listing.platform)}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  type="button"
                  className="button"
                  onClick={onClose}
                  style={{ fontSize: '9pt' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => setShowCredentialForm(true)}
                  style={{ fontSize: '9pt', flex: 1 }}
                >
                  Add {getPlatformName(listing.platform)} Login
                </button>
              </div>

              {/* Skip option */}
              <div style={{ textAlign: 'center', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setStep('bid')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    fontSize: '8pt',
                    cursor: 'pointer',
                    textDecoration: 'underline'
                  }}
                >
                  Skip for now (manual execution required)
                </button>
              </div>

              {/* Credential form modal */}
              <PlatformCredentialForm
                isOpen={showCredentialForm}
                onClose={() => setShowCredentialForm(false)}
                platform={listing.platform}
                onSaved={() => {
                  setShowCredentialForm(false);
                  setHasPlatformCredentials(true);
                  setStep('bid');
                }}
              />
            </div>
          )}

          {/* Bid form step */}
          {step === 'bid' && (
            <div>
              {/* Vehicle info */}
              <div style={{
                display: 'flex',
                gap: '12px',
                marginBottom: '20px',
                padding: '12px',
                background: 'var(--surface-hover)',
                borderRadius: '4px'
              }}>
                {listing.vehicle.primary_image_url && (
                  <img
                    src={listing.vehicle.primary_image_url}
                    alt=""
                    style={{
                      width: '80px',
                      height: '60px',
                      objectFit: 'cover',
                      borderRadius: '4px'
                    }}
                  />
                )}
                <div>
                  <div style={{ fontSize: '10pt', fontWeight: 700 }}>
                    {listing.vehicle.year} {listing.vehicle.make} {listing.vehicle.model}
                  </div>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                    on {getPlatformName(listing.platform)}
                  </div>
                  {currentBid > 0 && (
                    <div style={{ fontSize: '9pt', marginTop: '4px' }}>
                      Current bid: <strong>${currentBid.toLocaleString()}</strong>
                    </div>
                  )}
                </div>
              </div>

              {/* Max bid input */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '8pt', fontWeight: 600, marginBottom: '4px' }}>
                  Maximum Bid Amount *
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
                    value={maxBid}
                    onChange={(e) => setMaxBid(e.target.value)}
                    placeholder={minBid.toLocaleString()}
                    style={{
                      width: '100%',
                      padding: '10px 12px 10px 24px',
                      border: '1px solid var(--border)',
                      fontSize: '11pt',
                      fontWeight: 600
                    }}
                  />
                </div>
                <p style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Minimum bid: ${minBid.toLocaleString()}. We'll bid up to this amount on your behalf.
                </p>
              </div>

              {/* Bid strategy */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '8pt', fontWeight: 600, marginBottom: '8px' }}>
                  Bidding Strategy
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    padding: '10px 12px',
                    background: bidStrategy === 'proxy_auto' ? 'var(--accent-dim)' : 'var(--surface-hover)',
                    border: `2px solid ${bidStrategy === 'proxy_auto' ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}>
                    <input
                      type="radio"
                      name="strategy"
                      checked={bidStrategy === 'proxy_auto'}
                      onChange={() => setBidStrategy('proxy_auto')}
                      style={{ marginTop: '2px' }}
                    />
                    <div>
                      <div style={{ fontSize: '9pt', fontWeight: 600 }}>Standard Proxy</div>
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                        Bid incrementally as needed to stay winning
                      </div>
                    </div>
                  </label>
                  <label style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    padding: '10px 12px',
                    background: bidStrategy === 'snipe_last_minute' ? 'var(--accent-dim)' : 'var(--surface-hover)',
                    border: `2px solid ${bidStrategy === 'snipe_last_minute' ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}>
                    <input
                      type="radio"
                      name="strategy"
                      checked={bidStrategy === 'snipe_last_minute'}
                      onChange={() => setBidStrategy('snipe_last_minute')}
                      style={{ marginTop: '2px' }}
                    />
                    <div>
                      <div style={{ fontSize: '9pt', fontWeight: 600 }}>Last-Minute Snipe</div>
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                        Place bid in the final minutes of the auction
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Cost breakdown */}
              {maxBidCents > 0 && (
                <div style={{
                  background: 'var(--surface-hover)',
                  padding: '12px',
                  borderRadius: '4px',
                  marginBottom: '16px',
                  fontSize: '8pt'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span>Maximum bid:</span>
                    <span>${maxBidAmount.toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span>Refundable deposit (10%):</span>
                    <span>${depositAmount.toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: '6px' }}>
                    <span>Estimated commission ({commissionRateDisplay}%):</span>
                    <span>${commissionAmount.toLocaleString()}</span>
                  </div>
                  <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '6px' }}>
                    Risk tier: {commissionTier.label} — {commissionTier.description}. Final commission is based on the winning price.
                  </div>
                </div>
              )}

              {/* Deposit agreement */}
              <label style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                marginBottom: '16px',
                cursor: 'pointer'
              }}>
                <input
                  type="checkbox"
                  checked={agreedToDeposit}
                  onChange={(e) => setAgreedToDeposit(e.target.checked)}
                  style={{ marginTop: '2px' }}
                />
                <span style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
                  I authorize N-Zero to hold a refundable deposit of ${depositAmount.toLocaleString()} (10% of max bid).
                  This will be refunded if I don't win, or applied toward my commission if I do win.
                </span>
              </label>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  type="button"
                  className="button"
                  onClick={onClose}
                  style={{ fontSize: '9pt' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={handleSubmitBid}
                  disabled={!maxBidCents || !agreedToDeposit || maxBidCents < minBid * 100}
                  style={{ fontSize: '9pt', flex: 1 }}
                >
                  Review Bid
                </button>
              </div>
            </div>
          )}

          {/* Confirmation step */}
          {step === 'confirm' && (
            <div>
              <div style={{
                background: '#fef3c7',
                border: '1px solid #fcd34d',
                padding: '12px',
                borderRadius: '4px',
                marginBottom: '16px',
                fontSize: '9pt'
              }}>
                <strong>Please confirm your proxy bid:</strong>
              </div>

              <div style={{
                background: 'var(--surface-hover)',
                padding: '16px',
                borderRadius: '4px',
                marginBottom: '16px'
              }}>
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Vehicle</div>
                  <div style={{ fontSize: '10pt', fontWeight: 600 }}>
                    {listing.vehicle.year} {listing.vehicle.make} {listing.vehicle.model}
                  </div>
                </div>
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Platform</div>
                  <div style={{ fontSize: '9pt' }}>{getPlatformName(listing.platform)}</div>
                </div>
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Maximum Bid</div>
                  <div style={{ fontSize: '12pt', fontWeight: 700, color: 'var(--accent)' }}>
                    ${maxBidAmount.toLocaleString()}
                  </div>
                </div>
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Strategy</div>
                  <div style={{ fontSize: '9pt' }}>
                    {bidStrategy === 'proxy_auto' ? 'Standard Proxy' : 'Last-Minute Snipe'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Deposit to Authorize</div>
                  <div style={{ fontSize: '10pt', fontWeight: 600 }}>${depositAmount.toLocaleString()}</div>
                </div>
                {maxBidCents > 0 && (
                  <div style={{ marginTop: '12px' }}>
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Estimated Commission</div>
                    <div style={{ fontSize: '10pt', fontWeight: 600 }}>
                      ${commissionAmount.toLocaleString()} ({commissionRateDisplay}% · {commissionTier.label})
                    </div>
                  </div>
                )}
              </div>

              <p style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '16px' }}>
                By confirming, you authorize N-Zero to bid up to ${maxBidAmount.toLocaleString()} on
                this vehicle. A deposit hold of ${depositAmount.toLocaleString()} will be placed on your
                payment method.
              </p>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  type="button"
                  className="button"
                  onClick={() => setStep('bid')}
                  disabled={loading}
                  style={{ fontSize: '9pt' }}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={handleConfirmBid}
                  disabled={loading}
                  style={{ fontSize: '9pt', flex: 1 }}
                >
                  {loading ? 'Placing Bid...' : 'Confirm & Place Bid'}
                </button>
              </div>
            </div>
          )}

          {/* Success step */}
          {step === 'success' && (
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <div style={{
                width: '64px',
                height: '64px',
                background: '#dcfce7',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
                fontSize: '24pt'
              }}>
                ✓
              </div>
              <h3 style={{ fontSize: '12pt', fontWeight: 700, marginBottom: '8px' }}>
                Proxy Bid Placed!
              </h3>
              <p style={{ fontSize: '9pt', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                We'll bid on your behalf up to ${maxBidAmount.toLocaleString()}.
                You'll receive notifications as the auction progresses.
              </p>
              <button
                type="button"
                className="button button-primary"
                onClick={onClose}
                style={{ fontSize: '9pt' }}
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
