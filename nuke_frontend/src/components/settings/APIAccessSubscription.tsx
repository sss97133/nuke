import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../hooks/useToast';

interface Subscription {
  id: string;
  subscription_type: 'monthly' | 'prepaid_credits' | 'pay_as_you_go';
  status: 'active' | 'cancelled' | 'expired' | 'past_due';
  credits_remaining: number | null;
  monthly_limit: number | null;
  current_period_end: string | null;
  stripe_subscription_id: string | null;
}

const APIAccessSubscription: React.FC = () => {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    loadSubscription();
  }, []);

  const loadSubscription = async () => {
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const { data, error } = await supabase
        .from('api_access_subscriptions')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116' && error.code !== 'PGRST301') {
        console.error('Error loading subscription:', error);
      }

      setSubscription(data || null);
    } catch (error) {
      console.error('Error loading subscription:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = async (subscriptionType: string) => {
    try {
      setCheckoutLoading(true);
      const { data, error } = await supabase.functions.invoke('create-api-access-checkout', {
        body: {
          subscription_type: subscriptionType,
          success_url: `${window.location.origin}/capsule?tab=settings&api_access=success`,
          cancel_url: `${window.location.origin}/capsule?tab=settings&api_access=cancelled`
        }
      });

      if (error) throw error;

      if (data?.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (error: any) {
      console.error('Error creating checkout:', error);
      showToast('Failed to create checkout session', 'error');
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (loading) {
    return <div className="text text-muted">Loading subscription...</div>;
  }

  const isActive = subscription?.status === 'active';
  const isMonthly = subscription?.subscription_type === 'monthly';
  const isPrepaid = subscription?.subscription_type === 'prepaid_credits';

  return (
    <div className="card">
      <div className="card-header">
        <h3 className="heading-3">API Access Subscription</h3>
      </div>
      <div className="card-body">
        {!subscription ? (
          <div>
            <p className="text" style={{ marginBottom: 'var(--space-4)' }}>
              Subscribe to use AI image analysis features. You'll add your own API keys (OpenAI, Anthropic, Google Gemini) 
              and we'll use them for processing - you pay for platform access, API costs come from your accounts.
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div style={{
                padding: 'var(--space-3)',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                background: 'var(--grey-50)'
              }}>
                <h4 className="text font-bold" style={{ marginBottom: 'var(--space-2)' }}>
                  Monthly Subscription - $29.99/month
                </h4>
                <p className="text text-small" style={{ marginBottom: 'var(--space-2)' }}>
                  1,000 AI image analyses per month
                </p>
                <button
                  onClick={() => handleSubscribe('monthly')}
                  disabled={checkoutLoading}
                  className="button button-primary"
                  style={{ fontSize: '8pt', padding: '6px 12px' }}
                >
                  {checkoutLoading ? 'Loading...' : 'Subscribe Monthly'}
                </button>
              </div>

              <div style={{
                padding: 'var(--space-3)',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                background: 'var(--grey-50)'
              }}>
                <h4 className="text font-bold" style={{ marginBottom: 'var(--space-2)' }}>
                  Prepaid Credits
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                  <button
                    onClick={() => handleSubscribe('prepaid_100')}
                    disabled={checkoutLoading}
                    className="button button-secondary"
                    style={{ fontSize: '8pt', padding: '6px 12px', textAlign: 'left' }}
                  >
                    100 Images - $4.99
                  </button>
                  <button
                    onClick={() => handleSubscribe('prepaid_500')}
                    disabled={checkoutLoading}
                    className="button button-secondary"
                    style={{ fontSize: '8pt', padding: '6px 12px', textAlign: 'left' }}
                  >
                    500 Images - $19.99
                  </button>
                  <button
                    onClick={() => handleSubscribe('prepaid_1000')}
                    disabled={checkoutLoading}
                    className="button button-secondary"
                    style={{ fontSize: '8pt', padding: '6px 12px', textAlign: 'left' }}
                  >
                    1,000 Images - $34.99
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div style={{
              padding: 'var(--space-3)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              background: isActive ? 'var(--success-light)' : 'var(--warning-light)',
              marginBottom: 'var(--space-3)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                <h4 className="text font-bold">
                  {isMonthly ? 'Monthly Subscription' : 'Prepaid Credits'}
                </h4>
                <span className={`badge ${isActive ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: '7pt' }}>
                  {subscription.status.toUpperCase()}
                </span>
              </div>

              {isMonthly && subscription.current_period_end && (
                <p className="text text-small">
                  Renews: {new Date(subscription.current_period_end).toLocaleDateString()}
                </p>
              )}

              {isPrepaid && subscription.credits_remaining !== null && (
                <p className="text font-bold">
                  Credits Remaining: {subscription.credits_remaining}
                </p>
              )}

              {isMonthly && subscription.monthly_limit && (
                <p className="text text-small">
                  Monthly Limit: {subscription.monthly_limit} images
                </p>
              )}
            </div>

            <p className="text text-small text-muted">
              Add your API keys in the "AI Providers" section below. We'll use your keys for processing.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default APIAccessSubscription;

