/**
 * Subscription Flow
 *
 * Multi-step subscription agreement flow for Reg A+ offerings:
 * 1. Review investment details
 * 2. Verify suitability
 * 3. Sign subscription agreement
 * 4. Fund investment
 */

import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { usePlatformStatus } from '../../hooks/usePlatformStatus';
import { useAuth } from '../../hooks/useAuth';

interface Offering {
  id: string;
  offering_name: string;
  price_per_share: number;
  min_investment: number;
  max_offering_amount: number;
  amount_raised: number;
  entity: {
    entity_name: string;
    state_of_formation: string;
  };
}

interface SubscriptionState {
  shares: number;
  totalAmount: number;
  suitabilityConfirmed: boolean;
  agreementSigned: boolean;
  fundingMethod: 'ach' | 'wire' | 'credit' | null;
  fundingComplete: boolean;
}

export function SubscriptionFlow() {
  const { offeringId } = useParams<{ offeringId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isDemoMode, logMetric } = usePlatformStatus();

  const [offering, setOffering] = useState<Offering | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const requestedAmount = parseFloat(searchParams.get('amount') || '0');

  const [state, setState] = useState<SubscriptionState>({
    shares: 0,
    totalAmount: requestedAmount,
    suitabilityConfirmed: false,
    agreementSigned: false,
    fundingMethod: null,
    fundingComplete: false
  });

  useEffect(() => {
    if (offeringId) {
      loadOffering();
      logMetric('subscription_started', 'offering', offeringId);
    }
  }, [offeringId, logMetric]);

  useEffect(() => {
    if (offering && requestedAmount > 0) {
      setState(prev => ({
        ...prev,
        totalAmount: requestedAmount,
        shares: Math.floor(requestedAmount / offering.price_per_share)
      }));
    }
  }, [offering, requestedAmount]);

  async function loadOffering() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('reg_a_offerings')
        .select(`
          id, offering_name, price_per_share, min_investment,
          max_offering_amount, amount_raised,
          entity:asset_legal_entities(entity_name, state_of_formation)
        `)
        .eq('id', offeringId)
        .single();

      if (error) throw error;
      setOffering(data);
    } catch (error) {
      console.error('Error loading offering:', error);
    }
    setLoading(false);
  }

  async function handleSubmitSubscription() {
    if (!user || !offering) return;

    setSubmitting(true);
    logMetric('subscription_submitted', 'offering', offeringId);

    try {
      // Create subscription agreement record
      const { data: subscription, error } = await supabase
        .from('subscription_agreements')
        .insert({
          user_id: user.id,
          offering_id: offeringId,
          shares_subscribed: state.shares,
          total_amount: state.totalAmount,
          status: 'pending',
          signature_timestamp: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      // In demo mode, auto-complete the funding
      if (isDemoMode) {
        await supabase
          .from('subscription_agreements')
          .update({ status: 'funded' })
          .eq('id', subscription.id);

        logMetric('subscription_funded', 'subscription', subscription.id);
      }

      // Navigate to success
      navigate(`/invest/subscription/${subscription.id}/success`);
    } catch (error) {
      console.error('Error submitting subscription:', error);
    }
    setSubmitting(false);
  }

  function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  }

  const steps = [
    { id: 'review', title: 'Review' },
    { id: 'suitability', title: 'Suitability' },
    { id: 'agreement', title: 'Agreement' },
    { id: 'funding', title: 'Funding' }
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8">
        <div className="max-w-2xl mx-auto">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-700 rounded w-1/3"></div>
            <div className="h-64 bg-gray-700 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!offering) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-2xl font-bold mb-4">Offering Not Found</h1>
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
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate(`/invest/offering/${offeringId}`)}
            className="text-gray-400 hover:text-white mb-4 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Offering
          </button>
          <h1 className="text-2xl font-bold">Subscribe to {offering.offering_name}</h1>
          {isDemoMode && (
            <p className="text-amber-400 text-sm mt-1">Demo Mode - Simulated subscription</p>
          )}
        </div>

        {/* Progress steps */}
        <div className="flex mb-8">
          {steps.map((step, index) => (
            <div key={step.id} className="flex-1 flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  index < currentStep
                    ? 'bg-green-600 text-white'
                    : index === currentStep
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-400'
                }`}
              >
                {index < currentStep ? '✓' : index + 1}
              </div>
              <div className="flex-1 h-1 bg-gray-700 mx-2">
                <div
                  className="h-full bg-blue-600 transition-all"
                  style={{ width: index < currentStep ? '100%' : '0%' }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="bg-gray-800 rounded-lg p-6">
          {currentStep === 0 && (
            <ReviewStep
              offering={offering}
              state={state}
              setState={setState}
              onContinue={() => setCurrentStep(1)}
              formatCurrency={formatCurrency}
            />
          )}
          {currentStep === 1 && (
            <SuitabilityStep
              state={state}
              setState={setState}
              onContinue={() => setCurrentStep(2)}
              onBack={() => setCurrentStep(0)}
            />
          )}
          {currentStep === 2 && (
            <AgreementStep
              offering={offering}
              state={state}
              setState={setState}
              onContinue={() => setCurrentStep(3)}
              onBack={() => setCurrentStep(1)}
              formatCurrency={formatCurrency}
            />
          )}
          {currentStep === 3 && (
            <FundingStep
              state={state}
              setState={setState}
              onSubmit={handleSubmitSubscription}
              onBack={() => setCurrentStep(2)}
              submitting={submitting}
              isDemoMode={isDemoMode}
              formatCurrency={formatCurrency}
            />
          )}
        </div>
      </div>
    </div>
  );
}

interface StepProps {
  offering?: Offering;
  state: SubscriptionState;
  setState: React.Dispatch<React.SetStateAction<SubscriptionState>>;
  onContinue?: () => void;
  onBack?: () => void;
  onSubmit?: () => void;
  submitting?: boolean;
  isDemoMode?: boolean;
  formatCurrency: (value: number) => string;
}

function ReviewStep({ offering, state, setState, onContinue, formatCurrency }: StepProps) {
  if (!offering) return null;

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Review Investment</h2>

      <div className="space-y-4 mb-6">
        <div className="flex justify-between py-2 border-b border-gray-700">
          <span className="text-gray-400">Offering</span>
          <span className="text-white">{offering.offering_name}</span>
        </div>
        <div className="flex justify-between py-2 border-b border-gray-700">
          <span className="text-gray-400">Issuer</span>
          <span className="text-white">{offering.entity?.entity_name}</span>
        </div>
        <div className="flex justify-between py-2 border-b border-gray-700">
          <span className="text-gray-400">Price per Share</span>
          <span className="text-white font-mono">{formatCurrency(offering.price_per_share)}</span>
        </div>

        <div className="pt-4">
          <label className="block text-gray-400 text-sm mb-2">Number of Shares</label>
          <input
            type="number"
            value={state.shares}
            onChange={(e) => {
              const shares = parseInt(e.target.value) || 0;
              setState(prev => ({
                ...prev,
                shares,
                totalAmount: shares * offering.price_per_share
              }));
            }}
            min={1}
            className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-3 text-white text-lg font-mono"
          />
        </div>

        <div className="flex justify-between py-4 border-t border-gray-700 text-lg">
          <span className="text-white font-bold">Total Investment</span>
          <span className="text-white font-bold font-mono">{formatCurrency(state.totalAmount)}</span>
        </div>
      </div>

      {state.totalAmount < offering.min_investment && (
        <div className="mb-4 p-3 bg-amber-900/20 border border-amber-500/30 rounded">
          <span className="text-amber-400 text-sm">
            Minimum investment is {formatCurrency(offering.min_investment)}
          </span>
        </div>
      )}

      <button
        onClick={onContinue}
        disabled={state.shares < 1 || state.totalAmount < offering.min_investment}
        className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded text-white font-bold disabled:opacity-50"
      >
        Continue
      </button>
    </div>
  );
}

function SuitabilityStep({ state, setState, onContinue, onBack }: StepProps) {
  const [answers, setAnswers] = useState({
    understandsRisks: false,
    canAffordLoss: false,
    longTermHorizon: false,
    noLiquidityNeeds: false
  });

  const allConfirmed = Object.values(answers).every(Boolean);

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Investor Suitability</h2>
      <p className="text-gray-400 mb-6">
        Please confirm the following statements to proceed with your investment.
      </p>

      <div className="space-y-4 mb-6">
        {[
          { key: 'understandsRisks', text: 'I understand that this investment is speculative and I may lose my entire investment.' },
          { key: 'canAffordLoss', text: 'I can afford to lose the full amount of this investment without affecting my lifestyle.' },
          { key: 'longTermHorizon', text: 'I understand this is a long-term investment and I may not be able to sell for an extended period.' },
          { key: 'noLiquidityNeeds', text: 'I do not have an immediate need for the funds I am investing.' }
        ].map(({ key, text }) => (
          <label key={key} className="flex items-start gap-3 p-4 bg-gray-700 rounded cursor-pointer">
            <input
              type="checkbox"
              checked={answers[key as keyof typeof answers]}
              onChange={(e) => setAnswers(prev => ({ ...prev, [key]: e.target.checked }))}
              className="mt-1"
            />
            <span className="text-white text-sm">{text}</span>
          </label>
        ))}
      </div>

      <div className="flex gap-4">
        <button
          onClick={onBack}
          className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 rounded text-white"
        >
          Back
        </button>
        <button
          onClick={() => {
            setState(prev => ({ ...prev, suitabilityConfirmed: true }));
            onContinue?.();
          }}
          disabled={!allConfirmed}
          className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 rounded text-white font-bold disabled:opacity-50"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function AgreementStep({ offering, state, setState, onContinue, onBack, formatCurrency }: StepProps) {
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState('');

  if (!offering) return null;

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Subscription Agreement</h2>

      <div className="bg-gray-900 rounded p-4 mb-6 max-h-64 overflow-y-auto text-sm text-gray-300">
        <h3 className="text-white font-bold mb-2">SUBSCRIPTION AGREEMENT</h3>
        <p className="mb-4">
          This Subscription Agreement is entered into by and between {offering.entity?.entity_name},
          a {offering.entity?.state_of_formation} limited liability company ("Company"), and the undersigned
          subscriber ("Subscriber").
        </p>
        <p className="mb-4">
          SUBSCRIPTION: Subscriber hereby subscribes for {state.shares.toLocaleString()} shares of the Company
          at a price of {formatCurrency(offering.price_per_share)} per share, for a total subscription amount
          of {formatCurrency(state.totalAmount)}.
        </p>
        <p className="mb-4">
          REPRESENTATIONS: Subscriber represents that: (a) Subscriber has received and reviewed the Offering
          Circular and all related documents; (b) Subscriber understands the risks of this investment;
          (c) Subscriber can afford a complete loss of this investment; (d) Subscriber's investment does not
          exceed applicable investment limits.
        </p>
        <p className="mb-4">
          RISKS: This investment involves significant risks including but not limited to: total loss of
          investment, illiquidity, no guarantee of returns, conflicts of interest, and market volatility.
        </p>
        <p className="mb-4">
          GOVERNING LAW: This Agreement shall be governed by the laws of the State of {offering.entity?.state_of_formation}.
        </p>
      </div>

      <label className="flex items-start gap-3 p-4 bg-gray-700 rounded cursor-pointer mb-4">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-1"
        />
        <span className="text-white text-sm">
          I have read, understood, and agree to the terms of this Subscription Agreement and the Offering Circular.
        </span>
      </label>

      <div className="mb-6">
        <label className="block text-gray-400 text-sm mb-2">Type your full legal name to sign:</label>
        <input
          type="text"
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          placeholder="Full Legal Name"
          className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-3 text-white"
        />
      </div>

      <div className="flex gap-4">
        <button
          onClick={onBack}
          className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 rounded text-white"
        >
          Back
        </button>
        <button
          onClick={() => {
            setState(prev => ({ ...prev, agreementSigned: true }));
            onContinue?.();
          }}
          disabled={!agreed || !signature.trim()}
          className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 rounded text-white font-bold disabled:opacity-50"
        >
          Sign & Continue
        </button>
      </div>
    </div>
  );
}

function FundingStep({ state, setState, onSubmit, onBack, submitting, isDemoMode, formatCurrency }: StepProps) {
  const fundingMethods = [
    { id: 'ach', name: 'ACH Bank Transfer', description: 'Free, 3-5 business days' },
    { id: 'wire', name: 'Wire Transfer', description: 'Fees may apply, 1-2 business days' },
    { id: 'credit', name: 'Credit Card', description: '3% fee, instant' }
  ];

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Fund Your Investment</h2>

      {isDemoMode && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded p-3 mb-6">
          <span className="text-amber-400 text-sm">
            Demo Mode: No real funds will be transferred.
          </span>
        </div>
      )}

      <div className="mb-6">
        <div className="text-gray-400 text-sm mb-2">Investment Amount</div>
        <div className="text-3xl font-bold font-mono">{formatCurrency(state.totalAmount)}</div>
      </div>

      <div className="space-y-3 mb-6">
        {fundingMethods.map((method) => (
          <label
            key={method.id}
            className={`flex items-center gap-4 p-4 rounded cursor-pointer border ${
              state.fundingMethod === method.id
                ? 'border-blue-500 bg-blue-900/20'
                : 'border-gray-700 bg-gray-700'
            }`}
          >
            <input
              type="radio"
              name="funding"
              checked={state.fundingMethod === method.id}
              onChange={() => setState(prev => ({ ...prev, fundingMethod: method.id as any }))}
              className="text-blue-600"
            />
            <div>
              <div className="text-white font-medium">{method.name}</div>
              <div className="text-gray-400 text-sm">{method.description}</div>
            </div>
          </label>
        ))}
      </div>

      <div className="flex gap-4">
        <button
          onClick={onBack}
          className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 rounded text-white"
        >
          Back
        </button>
        <button
          onClick={onSubmit}
          disabled={!state.fundingMethod || submitting}
          className="flex-1 py-3 bg-green-600 hover:bg-green-500 rounded text-white font-bold disabled:opacity-50"
        >
          {submitting ? 'Processing...' : 'Complete Investment'}
        </button>
      </div>

      <p className="text-gray-500 text-xs mt-4 text-center">
        By clicking Complete Investment, you authorize the transfer of funds and agree to the terms of your subscription.
      </p>
    </div>
  );
}

export default SubscriptionFlow;
