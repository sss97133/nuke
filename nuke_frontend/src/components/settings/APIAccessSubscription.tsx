import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../hooks/useToast';
import { CashBalanceService } from '../../services/cashBalanceService';

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
  const [cashBalance, setCashBalance] = useState<number>(0);
  const [purchasingCredits, setPurchasingCredits] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState<string>('');
  const { showToast } = useToast();

  useEffect(() => {
    loadSubscription();
    loadCashBalance();
  }, []);

  const loadCashBalance = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const balance = await CashBalanceService.getUserBalance(session.user.id);
      setCashBalance(balance?.available_cents || 0);
    } catch (error) {
      console.error('Error loading cash balance:', error);
    }
  };

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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        showToast('Not authenticated', 'error');
        return;
      }

      // Prepaid credits: use cash balance
      if (subscriptionType.startsWith('prepaid_')) {
        setPurchasingCredits(subscriptionType);
        
        const plans: Record<string, { amount: number; credits: number }> = {
          prepaid_100: { amount: 499, credits: 100 },
          prepaid_500: { amount: 1999, credits: 500 },
          prepaid_1000: { amount: 3499, credits: 1000 }
        };

        const plan = plans[subscriptionType];
        if (!plan) {
          showToast('Invalid plan', 'error');
          return;
        }

        // Check balance
        if (cashBalance < plan.amount) {
          showToast(`Insufficient balance. Need $${(plan.amount / 100).toFixed(2)}, have $${(cashBalance / 100).toFixed(2)}`, 'error');
          setPurchasingCredits(null);
          return;
        }

        // Deduct from balance and create subscription
        const { error: deductError } = await supabase.rpc('deduct_cash_from_user', {
          p_user_id: session.user.id,
          p_amount_cents: plan.amount,
          p_transaction_type: 'api_access_purchase',
          p_metadata: {
            subscription_type: 'prepaid_credits',
            credits: plan.credits
          }
        });

        if (deductError) {
          throw deductError;
        }

        // Create or update subscription
        const { error: subError } = await supabase
          .from('api_access_subscriptions')
          .upsert({
            user_id: session.user.id,
            subscription_type: 'prepaid_credits',
            status: 'active',
            credits_remaining: (subscription?.credits_remaining || 0) + plan.credits,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'user_id'
          });

        if (subError) {
          throw subError;
        }

        showToast(`Purchased ${plan.credits} credits for $${(plan.amount / 100).toFixed(2)}`, 'success');
        await loadSubscription();
        await loadCashBalance();
        setPurchasingCredits(null);
        return;
      }

      // Monthly subscription: use Stripe
      setCheckoutLoading(true);
      const { data, error } = await supabase.functions.invoke('create-api-access-checkout', {
        body: {
          subscription_type: subscriptionType,
          success_url: `${window.location.origin}/capsule?tab=api-access&api_access=success`,
          cancel_url: `${window.location.origin}/capsule?tab=api-access&api_access=cancelled`
        }
      });

      if (error) throw error;

      if (data?.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (error: any) {
      console.error('Error processing subscription:', error);
      showToast(error?.message || 'Failed to process subscription', 'error');
      setPurchasingCredits(null);
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleCustomPurchase = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        showToast('Not authenticated', 'error');
        return;
      }

      const amountUSD = parseFloat(customAmount);
      if (!amountUSD || amountUSD <= 0) {
        showToast('Please enter a valid amount', 'error');
        return;
      }

      const amountCents = Math.round(amountUSD * 100);
      const estimatedCredits = Math.floor(amountCents / 5); // ~$0.05 per image

      setPurchasingCredits('custom');

      // Check balance
      if (cashBalance < amountCents) {
        showToast(`Insufficient balance. Need $${amountUSD.toFixed(2)}, have $${(cashBalance / 100).toFixed(2)}`, 'error');
        setPurchasingCredits(null);
        return;
      }

      // Deduct from balance and create subscription
      const { error: deductError } = await supabase.rpc('deduct_cash_from_user', {
        p_user_id: session.user.id,
        p_amount_cents: amountCents,
        p_transaction_type: 'api_access_purchase',
        p_metadata: {
          subscription_type: 'prepaid_credits',
          credits: estimatedCredits,
          custom_amount: amountUSD
        }
      });

      if (deductError) {
        throw deductError;
      }

      // Create or update subscription
      const { error: subError } = await supabase
        .from('api_access_subscriptions')
        .upsert({
          user_id: session.user.id,
          subscription_type: 'prepaid_credits',
          status: 'active',
          credits_remaining: (subscription?.credits_remaining || 0) + estimatedCredits,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        });

      if (subError) {
        throw subError;
      }

      showToast(`Purchased ${estimatedCredits} credits for $${amountUSD.toFixed(2)}`, 'success');
      await loadSubscription();
      await loadCashBalance();
      setCustomAmount('');
      setPurchasingCredits(null);
    } catch (error: any) {
      console.error('Error purchasing credits:', error);
      showToast(error?.message || 'Failed to purchase credits', 'error');
      setPurchasingCredits(null);
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
        <h3 className="heading-3">AI Analysis Credits</h3>
      </div>
      <div className="card-body">
        {!subscription ? (
          <div>
            <p className="text" style={{ marginBottom: 'var(--space-4)' }}>
              Purchase credits to use AI image analysis features. The platform handles all API costs - no need to add your own keys.
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div style={{
                padding: 'var(--space-3)',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                background: 'var(--grey-50)'
              }}>
                <h4 className="text font-bold" style={{ marginBottom: 'var(--space-2)' }}>
                  Purchase Credits (From Balance)
                </h4>
                <p className="text text-small text-muted" style={{ marginBottom: 'var(--space-2)' }}>
                  Your Balance: ${(cashBalance / 100).toFixed(2)}
                </p>
                <p className="text text-small" style={{ marginBottom: 'var(--space-3)' }}>
                  Enter any amount to purchase credits. Credits are used for AI image analysis (approximately $0.05 per image).
                </p>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', marginBottom: 'var(--space-2)' }}>
                  <div style={{ flex: 1 }}>
                    <label className="text text-small" style={{ display: 'block', marginBottom: '4px' }}>Amount ($)</label>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="Enter amount"
                      value={customAmount}
                      onChange={(e) => setCustomAmount(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        border: '1px solid var(--border)',
                        borderRadius: '2px',
                        fontSize: '9pt'
                      }}
                    />
                  </div>
                  <button
                    onClick={handleCustomPurchase}
                    disabled={!customAmount || parseFloat(customAmount) <= 0 || purchasingCredits === 'custom' || (parseFloat(customAmount) * 100) > cashBalance}
                    className="button button-primary"
                    style={{ 
                      fontSize: '8pt', 
                      padding: '6px 12px',
                      whiteSpace: 'nowrap',
                      opacity: (!customAmount || parseFloat(customAmount) <= 0 || (parseFloat(customAmount) * 100) > cashBalance) ? 0.5 : 1
                    }}
                  >
                    {purchasingCredits === 'custom' ? 'Processing...' : 'Purchase'}
                  </button>
                </div>
                {customAmount && parseFloat(customAmount) > 0 && (
                  <p className="text text-small text-muted">
                    ≈ {Math.floor((parseFloat(customAmount) * 100) / 5)} image analyses
                  </p>
                )}
                {cashBalance < 100 && (
                  <p className="text text-small text-muted" style={{ marginTop: 'var(--space-2)' }}>
                    Add funds in Financials tab to purchase credits
                  </p>
                )}
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

