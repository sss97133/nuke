/**
 * StripeConnect — Main Stripe Connect dashboard
 * Route: /stripe-connect
 *
 * Sections:
 * 1. Connect Setup — create a V2 connected account
 * 2. Account Status — onboarding state, billing portal, subscription
 * 3. Product Management — create / list products on the connected account
 * 4. Store Link — public storefront link
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const FUNCTIONS_URL = (import.meta as any).env?.VITE_SUPABASE_URL
  ? `${(import.meta as any).env.VITE_SUPABASE_URL}/functions/v1`
  : '';

async function callFn(name: string, body: object) {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token || '';

  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `${name} failed (${res.status})`);
  return data;
}

async function getFn(name: string, params: Record<string, string>) {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token || '';
  const qs = new URLSearchParams(params).toString();

  const res = await fetch(`${FUNCTIONS_URL}/${name}?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `${name} failed (${res.status})`);
  return data;
}

interface AccountStatus {
  account_id: string;
  readyToProcessPayments: boolean;
  onboardingComplete: boolean;
  requirementsStatus?: string;
}

interface StripeProduct {
  id: string;
  name: string;
  description: string | null;
  default_price?: { unit_amount: number; currency: string; id: string } | null;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)', padding: '24px',
  marginBottom: '24px',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 700,
  color: 'var(--text)',
  marginBottom: '16px',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--text-muted)',
  marginBottom: '4px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid var(--border)', fontSize: '14px',
  color: 'var(--text)',
  background: 'var(--bg)',
  marginBottom: '12px',
  boxSizing: 'border-box',
};

const btnPrimary: React.CSSProperties = {
  padding: '8px 16px',
  background: 'var(--primary)',
  color: 'var(--text-on-accent, #fff)',
  border: 'none', fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  padding: '8px 16px',
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border)', fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
  marginLeft: '8px',
};

const errStyle: React.CSSProperties = {
  color: 'var(--error)',
  fontSize: '13px',
  marginTop: '8px',
};

const mutedText: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--text-muted)',
};

export default function StripeConnect() {
  const [searchParams] = useSearchParams();

  // Local state: connected account ID (persisted in localStorage for demo purposes)
  const [accountId, setAccountId] = useState<string>(() =>
    localStorage.getItem('stripe_connect_account_id') || ''
  );

  // Create account form
  const [displayName, setDisplayName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  // Account status
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');

  // Products
  const [products, setProducts] = useState<StripeProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productName, setProductName] = useState('');
  const [productDescription, setProductDescription] = useState('');
  const [productPrice, setProductPrice] = useState('');
  const [productCreateLoading, setProductCreateLoading] = useState(false);
  const [productError, setProductError] = useState('');

  // Billing / subscription loading
  const [billingLoading, setBillingLoading] = useState(false);

  const fetchStatus = useCallback(async (id: string) => {
    setStatusLoading(true);
    setStatusError('');
    try {
      const data = await callFn('stripe-connect-account', { action: 'status', account_id: id });
      setStatus(data);
    } catch (e: any) {
      setStatusError(e.message);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const fetchProducts = useCallback(async (id: string) => {
    setProductsLoading(true);
    try {
      const data = await getFn('stripe-connect-products', { accountId: id });
      setProducts(data.products || []);
    } catch {
      // Non-fatal — show empty
    } finally {
      setProductsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (accountId) {
      fetchStatus(accountId);
      fetchProducts(accountId);
    }
  }, [accountId, fetchStatus, fetchProducts]);

  // Handle return from onboarding
  useEffect(() => {
    const returnedAccountId = searchParams.get('accountId');
    if (returnedAccountId && returnedAccountId !== accountId) {
      setAccountId(returnedAccountId);
      localStorage.setItem('stripe_connect_account_id', returnedAccountId);
    }
  }, [searchParams, accountId]);

  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault();
    setCreateLoading(true);
    setCreateError('');
    try {
      const data = await callFn('stripe-connect-account', {
        action: 'create',
        display_name: displayName,
        contact_email: contactEmail,
      });
      const id = data.account_id;
      setAccountId(id);
      localStorage.setItem('stripe_connect_account_id', id);
      await fetchStatus(id);
      await fetchProducts(id);
    } catch (e: any) {
      setCreateError(e.message);
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleGetOnboardingLink() {
    if (!accountId) return;
    try {
      const data = await callFn('stripe-connect-account', {
        action: 'get_link',
        account_id: accountId,
      });
      if (data.url) window.open(data.url, '_blank');
    } catch (e: any) {
      setStatusError(e.message);
    }
  }

  async function handleBillingPortal() {
    if (!accountId) return;
    setBillingLoading(true);
    try {
      const data = await callFn('stripe-connect-checkout', {
        action: 'billing_portal',
        accountId,
      });
      if (data.url) window.open(data.url, '_blank');
    } catch (e: any) {
      setStatusError(e.message);
    } finally {
      setBillingLoading(false);
    }
  }

  async function handleSubscribe() {
    if (!accountId) return;
    // NOTE: A real implementation would let the user select a price.
    // For the demo, we surface a note to set a price ID.
    setStatusError('Set a priceId for the platform subscription in StripeConnect.tsx to enable this button.');
  }

  async function handleCreateProduct(e: React.FormEvent) {
    e.preventDefault();
    setProductCreateLoading(true);
    setProductError('');
    try {
      const priceInCents = Math.round(parseFloat(productPrice) * 100);
      if (!priceInCents || isNaN(priceInCents)) {
        throw new Error('Enter a valid price (e.g. 29.99)');
      }
      await callFn('stripe-connect-products', {
        action: 'create',
        accountId,
        name: productName,
        description: productDescription || undefined,
        priceInCents,
      });
      setProductName('');
      setProductDescription('');
      setProductPrice('');
      await fetchProducts(accountId);
    } catch (e: any) {
      setProductError(e.message);
    } finally {
      setProductCreateLoading(false);
    }
  }

  function fmtPrice(cents: number | null | undefined, currency = 'usd') {
    if (cents == null) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
  }

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '32px 16px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text)', marginBottom: '8px' }}>
        Stripe Connect
      </h1>
      <p style={{ ...mutedText, marginBottom: '32px' }}>
        Create a connected account, onboard to collect payments, manage products, and view your storefront.
      </p>

      {/* ------------------------------------------------------------------ */}
      {/* 1. Connect Setup (show when no account yet)                         */}
      {/* ------------------------------------------------------------------ */}
      {!accountId && (
        <div style={cardStyle}>
          <div style={sectionTitleStyle}>Connect Setup</div>
          <p style={{ ...mutedText, marginBottom: '16px' }}>
            Create a Stripe V2 connected account to start collecting payments.
          </p>
          <form onSubmit={handleCreateAccount}>
            <label style={labelStyle}>Display Name</label>
            <input
              style={inputStyle}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="My Business"
              required
            />

            <label style={labelStyle}>Contact Email</label>
            <input
              style={inputStyle}
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />

            {createError && <p style={errStyle}>{createError}</p>}

            <button type="submit" style={btnPrimary} disabled={createLoading}>
              {createLoading ? 'Creating…' : 'Create Connected Account'}
            </button>
          </form>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 2. Account Status (show when account exists)                        */}
      {/* ------------------------------------------------------------------ */}
      {accountId && (
        <div style={cardStyle}>
          <div style={sectionTitleStyle}>Account Status</div>

          <div style={{ marginBottom: '12px' }}>
            <span style={labelStyle}>Account ID</span>
            <code style={{ fontSize: '13px', color: 'var(--text)', background: 'var(--grey-800, #f5f5f5)', padding: '2px 6px'}}>
              {accountId}
            </code>
          </div>

          {statusLoading && <p style={mutedText}>Loading status…</p>}

          {status && !statusLoading && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div>
                <span style={labelStyle}>Ready to Process Payments</span>
                <span style={{ fontSize: '14px', color: status.readyToProcessPayments ? 'var(--success)' : 'var(--error)' }}>
                  {status.readyToProcessPayments ? 'Yes' : 'No'}
                </span>
              </div>
              <div>
                <span style={labelStyle}>Onboarding Complete</span>
                <span style={{ fontSize: '14px', color: status.onboardingComplete ? 'var(--success)' : 'var(--error)' }}>
                  {status.onboardingComplete ? 'Yes' : 'No'}
                </span>
              </div>
              {status.requirementsStatus && (
                <div>
                  <span style={labelStyle}>Requirements Status</span>
                  <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                    {status.requirementsStatus}
                  </span>
                </div>
              )}
            </div>
          )}

          {statusError && <p style={errStyle}>{statusError}</p>}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <button style={btnPrimary} onClick={handleGetOnboardingLink}>
              Complete Onboarding
            </button>
            <button style={btnSecondary} onClick={handleBillingPortal} disabled={billingLoading}>
              {billingLoading ? 'Loading…' : 'Manage Subscription'}
            </button>
            <button style={btnSecondary} onClick={handleSubscribe}>
              Subscribe to Platform
            </button>
            <button
              style={btnSecondary}
              onClick={() => fetchStatus(accountId)}
              disabled={statusLoading}
            >
              Refresh Status
            </button>
          </div>

          <div style={{ marginTop: '12px' }}>
            <button
              style={{ ...mutedText, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              onClick={() => {
                localStorage.removeItem('stripe_connect_account_id');
                setAccountId('');
                setStatus(null);
                setProducts([]);
              }}
            >
              Switch account / start over
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 3. Product Management (only when account exists)                    */}
      {/* ------------------------------------------------------------------ */}
      {accountId && (
        <div style={cardStyle}>
          <div style={sectionTitleStyle}>Product Management</div>

          <form onSubmit={handleCreateProduct} style={{ marginBottom: '24px' }}>
            <label style={labelStyle}>Product Name</label>
            <input
              style={inputStyle}
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="e.g. Premium Access"
              required
            />

            <label style={labelStyle}>Description</label>
            <input
              style={inputStyle}
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
              placeholder="Optional description"
            />

            <label style={labelStyle}>Price (USD)</label>
            <input
              style={inputStyle}
              type="number"
              step="0.01"
              min="0.50"
              value={productPrice}
              onChange={(e) => setProductPrice(e.target.value)}
              placeholder="29.99"
              required
            />

            {productError && <p style={errStyle}>{productError}</p>}

            <button type="submit" style={btnPrimary} disabled={productCreateLoading}>
              {productCreateLoading ? 'Creating…' : 'Create Product'}
            </button>
          </form>

          {/* Product list */}
          {productsLoading && <p style={mutedText}>Loading products…</p>}
          {!productsLoading && products.length === 0 && (
            <p style={mutedText}>No products yet. Create one above.</p>
          )}
          {!productsLoading && products.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {products.map((p) => (
                <div
                  key={p.id}
                  style={{
                    border: '1px solid var(--border)', padding: '12px 16px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '12px',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text)' }}>{p.name}</div>
                    {p.description && (
                      <div style={{ ...mutedText, marginTop: '2px' }}>{p.description}</div>
                    )}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text)', whiteSpace: 'nowrap' }}>
                    {p.default_price
                      ? fmtPrice(p.default_price.unit_amount, p.default_price.currency)
                      : '—'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 4. Store Link                                                        */}
      {/* ------------------------------------------------------------------ */}
      {accountId && (
        <div style={cardStyle}>
          <div style={sectionTitleStyle}>Storefront</div>
          <p style={mutedText}>
            Share this link to let customers browse and purchase your products.
          </p>
          {/* TODO: use a human-readable identifier instead of accountId in production */}
          <Link
            to={`/stripe-connect/store/${accountId}`}
            style={{ color: 'var(--primary)', fontWeight: 600, fontSize: '14px' }}
          >
            /stripe-connect/store/{accountId}
          </Link>
        </div>
      )}
    </div>
  );
}
