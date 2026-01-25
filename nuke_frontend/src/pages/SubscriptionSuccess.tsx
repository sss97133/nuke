/**
 * Subscription Success Page
 *
 * Confirmation page after completing a subscription.
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { usePlatformStatus } from '../hooks/usePlatformStatus';

interface Subscription {
  id: string;
  shares_subscribed: number;
  total_amount: number;
  status: string;
  signature_timestamp: string;
  offering: {
    id: string;
    offering_name: string;
    price_per_share: number;
    entity: {
      entity_name: string;
    };
  };
}

export default function SubscriptionSuccess() {
  const { subscriptionId } = useParams<{ subscriptionId: string }>();
  const navigate = useNavigate();
  const { isDemoMode } = usePlatformStatus();

  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (subscriptionId) {
      loadSubscription();
    }
  }, [subscriptionId]);

  async function loadSubscription() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('subscription_agreements')
        .select(`
          id, shares_subscribed, total_amount, status, signature_timestamp,
          offering:reg_a_offerings(
            id, offering_name, price_per_share,
            entity:asset_legal_entities(entity_name)
          )
        `)
        .eq('id', subscriptionId)
        .single();

      if (error) throw error;
      setSubscription(data);
    } catch (error) {
      console.error('Error loading subscription:', error);
    }
    setLoading(false);
  }

  function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="animate-pulse text-center">
          <div className="h-16 w-16 bg-gray-700 rounded-full mx-auto mb-4"></div>
          <div className="h-6 bg-gray-700 rounded w-48 mx-auto"></div>
        </div>
      </div>
    );
  }

  if (!subscription) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-2xl font-bold mb-4">Subscription Not Found</h1>
          <button
            onClick={() => navigate('/invest')}
            className="px-4 py-2 bg-blue-600 rounded"
          >
            Back to Offerings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-2xl mx-auto px-4 py-16">
        {/* Success icon */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold mb-2">Investment Complete!</h1>
          <p className="text-gray-400">
            Your subscription has been submitted successfully.
          </p>
        </div>

        {isDemoMode && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-6 text-center">
            <span className="text-amber-400">
              Demo Mode: This is a simulated investment. No real funds were transferred.
            </span>
          </div>
        )}

        {/* Subscription details */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-lg font-bold mb-4">Investment Summary</h2>

          <div className="space-y-3">
            <div className="flex justify-between py-2 border-b border-gray-700">
              <span className="text-gray-400">Offering</span>
              <span className="text-white">{subscription.offering?.offering_name}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-700">
              <span className="text-gray-400">Issuer</span>
              <span className="text-white">{subscription.offering?.entity?.entity_name}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-700">
              <span className="text-gray-400">Shares</span>
              <span className="text-white font-mono">{subscription.shares_subscribed.toLocaleString()}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-700">
              <span className="text-gray-400">Price per Share</span>
              <span className="text-white font-mono">
                {formatCurrency(subscription.offering?.price_per_share || 0)}
              </span>
            </div>
            <div className="flex justify-between py-4 text-lg">
              <span className="text-white font-bold">Total Investment</span>
              <span className="text-white font-bold font-mono">
                {formatCurrency(subscription.total_amount)}
              </span>
            </div>
          </div>
        </div>

        {/* Status */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-lg font-bold mb-4">Status</h2>
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${
              subscription.status === 'funded' ? 'bg-green-500' :
              subscription.status === 'pending' ? 'bg-amber-500' : 'bg-gray-500'
            }`} />
            <span className="text-white capitalize">{subscription.status.replace('_', ' ')}</span>
          </div>
          <p className="text-gray-400 text-sm mt-2">
            {subscription.status === 'funded'
              ? 'Your investment has been received and shares will be issued shortly.'
              : subscription.status === 'pending'
              ? 'Awaiting payment confirmation. You will be notified when complete.'
              : 'Processing your subscription.'
            }
          </p>
        </div>

        {/* Next steps */}
        <div className="bg-gray-800 rounded-lg p-6 mb-8">
          <h2 className="text-lg font-bold mb-4">What Happens Next</h2>
          <ul className="space-y-3 text-gray-300 text-sm">
            <li className="flex items-start gap-3">
              <span className="text-blue-400">1.</span>
              <span>Your subscription will be reviewed and accepted within 1-2 business days.</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-blue-400">2.</span>
              <span>Once accepted, shares will be issued to your account.</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-blue-400">3.</span>
              <span>You can view your holdings in your portfolio at any time.</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-blue-400">4.</span>
              <span>You'll receive updates on the asset's performance and any distributions.</span>
            </li>
          </ul>
        </div>

        {/* Actions */}
        <div className="flex gap-4">
          <Link
            to="/market/portfolio"
            className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 rounded text-white text-center font-bold"
          >
            View Portfolio
          </Link>
          <Link
            to="/invest"
            className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 rounded text-white text-center"
          >
            Browse More Offerings
          </Link>
        </div>

        {/* Confirmation ID */}
        <p className="text-gray-500 text-xs text-center mt-6">
          Confirmation ID: {subscription.id}
        </p>
      </div>
    </div>
  );
}
