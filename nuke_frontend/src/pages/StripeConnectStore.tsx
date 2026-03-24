/**
 * StripeConnectStore — Public product storefront for a connected account
 * Route: /stripe-connect/store/:accountId
 *
 * No auth required — anyone with the link can view and purchase products.
 */

// TODO: use a human-readable slug instead of accountId in the URL

import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

const FUNCTIONS_URL = (import.meta as any).env?.VITE_SUPABASE_URL
  ? `${(import.meta as any).env.VITE_SUPABASE_URL}/functions/v1`
  : '';

const ANON_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

interface StripeProduct {
  id: string;
  name: string;
  description: string | null;
  default_price?: { unit_amount: number; currency: string; id: string } | null;
}

async function listProducts(accountId: string): Promise<StripeProduct[]> {
  const res = await fetch(
    `${FUNCTIONS_URL}/stripe-connect-products?accountId=${encodeURIComponent(accountId)}`,
    { headers: { apikey: ANON_KEY } }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load products');
  return data.products || [];
}

async function createCheckout(accountId: string, priceId: string, priceInCents: number): Promise<string> {
  const res = await fetch(`${FUNCTIONS_URL}/stripe-connect-checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ action: 'direct_charge', accountId, priceId, priceInCents }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to create checkout session');
  return data.url;
}

function fmtPrice(cents: number | null | undefined, currency = 'usd') {
  if (cents == null) return 'Free';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)', padding: '20px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const btnPrimary: React.CSSProperties = {
  padding: '10px 20px',
  background: 'var(--primary)',
  color: 'var(--surface-elevated)',
  border: 'none', fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
  width: '100%',
};

const mutedText: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--text-muted)',
};

export default function StripeConnectStore() {
  const { accountId } = useParams<{ accountId: string }>();
  const [searchParams] = useSearchParams();
  const isSuccess = searchParams.get('success') === 'true';

  const [products, setProducts] = useState<StripeProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [buyError, setBuyError] = useState('');

  useEffect(() => {
    if (!accountId) return;
    listProducts(accountId)
      .then(setProducts)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [accountId]);

  async function handleBuyNow(product: StripeProduct) {
    if (!accountId || !product.default_price) return;
    setBuyingId(product.id);
    setBuyError('');
    try {
      const checkoutUrl = await createCheckout(
        accountId,
        product.default_price.id,
        product.default_price.unit_amount
      );
      window.location.href = checkoutUrl;
    } catch (e: any) {
      setBuyError(e.message);
      setBuyingId(null);
    }
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '40px 16px' }}>
      {/* Success banner */}
      {isSuccess && (
        <div
          style={{
            background: 'var(--success-dim)',
            border: '2px solid var(--success)', padding: '16px 20px',
            marginBottom: '24px',
            color: 'var(--success)',
            fontWeight: 700,
            fontSize: '11px',
            fontFamily: 'Arial, sans-serif',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.08em',
          }}
        >
          PAYMENT SUCCESSFUL
        </div>
      )}

      <h1 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', marginBottom: '4px', textTransform: 'uppercase' as const, letterSpacing: '0.04em', fontFamily: 'Arial, sans-serif' }}>
        STORE
      </h1>
      <p style={{ ...mutedText, marginBottom: '32px' }}>
        Browse and purchase products from this seller.
      </p>

      {loading && <p style={mutedText}>LOADING...</p>}

      {error && (
        <div
          style={{
            background: 'var(--error-dim)',
            border: '2px solid var(--error)', padding: '12px 16px',
            color: 'var(--error)',
            fontSize: '11px',
            fontFamily: 'Arial, sans-serif',
          }}
        >
          {error}
        </div>
      )}

      {!loading && !error && products.length === 0 && (
        <p style={mutedText}>NO PRODUCTS AVAILABLE IN THIS STORE YET.</p>
      )}

      {buyError && (
        <div
          style={{
            background: 'var(--error-dim)',
            border: '2px solid var(--error)', padding: '12px 16px',
            color: 'var(--error)',
            fontSize: '11px',
            fontFamily: 'Arial, sans-serif',
            marginBottom: '16px',
          }}
        >
          {buyError}
        </div>
      )}

      {!loading && products.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: '20px',
          }}
        >
          {products.map((product) => (
            <div key={product.id} style={cardStyle}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '16px', color: 'var(--text)' }}>
                  {product.name}
                </div>
                {product.description && (
                  <div style={{ ...mutedText, marginTop: '6px', lineHeight: 1.5 }}>
                    {product.description}
                  </div>
                )}
              </div>

              <div
                style={{
                  fontSize: '24px',
                  fontWeight: 800,
                  color: 'var(--text)',
                }}
              >
                {product.default_price
                  ? fmtPrice(product.default_price.unit_amount, product.default_price.currency)
                  : 'Free'}
              </div>

              <button
                style={{
                  ...btnPrimary,
                  opacity: buyingId === product.id || !product.default_price ? 0.7 : 1,
                }}
                onClick={() => handleBuyNow(product)}
                disabled={buyingId === product.id || !product.default_price}
              >
                {buyingId === product.id ? 'Redirecting to Stripe…' : 'Buy Now'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: '48px', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
        <p style={mutedText}>
          Payments are processed securely by Stripe. Platform powered by{' '}
          <a href="https://nuke.ag" style={{ color: 'var(--primary)' }}>Nuke</a>.
        </p>
      </div>
    </div>
  );
}
