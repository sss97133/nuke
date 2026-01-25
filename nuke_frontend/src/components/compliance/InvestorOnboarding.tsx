/**
 * Investor Onboarding Flow
 *
 * Multi-step onboarding for investment platform:
 * 1. Account Setup
 * 2. KYC Verification
 * 3. Accreditation Status
 * 4. Risk Disclosures
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { usePlatformStatus } from '../../hooks/usePlatformStatus';

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  required: boolean;
}

interface InvestorOnboardingProps {
  userId: string;
  onComplete?: () => void;
  onClose?: () => void;
}

export function InvestorOnboarding({ userId, onComplete, onClose }: InvestorOnboardingProps) {
  const { isDemoMode, logMetric } = usePlatformStatus();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [steps, setSteps] = useState<OnboardingStep[]>([
    { id: 'account', title: 'Account Setup', description: 'Basic profile information', completed: false, required: true },
    { id: 'kyc', title: 'Identity Verification', description: 'Verify your identity', completed: false, required: true },
    { id: 'accreditation', title: 'Investor Status', description: 'Accreditation questionnaire', completed: false, required: false },
    { id: 'disclosures', title: 'Risk Disclosures', description: 'Acknowledge investment risks', completed: false, required: true },
  ]);

  useEffect(() => {
    loadOnboardingStatus();
    logMetric('onboarding_started', 'user', userId);
  }, [userId, logMetric]);

  async function loadOnboardingStatus() {
    setLoading(true);
    try {
      // Check profile completion
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      // Check KYC status
      const { data: verification } = await supabase
        .from('user_verifications')
        .select('*')
        .eq('user_id', userId)
        .eq('verification_type', 'id_document')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // Check accreditation
      const { data: accreditation } = await supabase
        .from('investor_accreditation')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // Check disclosures
      const { data: disclosures } = await supabase
        .from('risk_disclosure_acknowledgments')
        .select('disclosure_type')
        .eq('user_id', userId);

      const requiredDisclosures = ['illiquidity', 'total_loss', 'no_guarantee'];
      const acknowledgedTypes = new Set(disclosures?.map(d => d.disclosure_type) || []);
      const disclosuresComplete = requiredDisclosures.every(t => acknowledgedTypes.has(t));

      setSteps(prev => prev.map(step => {
        switch (step.id) {
          case 'account':
            return { ...step, completed: !!profile?.display_name };
          case 'kyc':
            return { ...step, completed: verification?.status === 'approved' };
          case 'accreditation':
            return { ...step, completed: !!accreditation };
          case 'disclosures':
            return { ...step, completed: disclosuresComplete };
          default:
            return step;
        }
      }));

      // Find first incomplete step
      const firstIncomplete = steps.findIndex(s => !s.completed && s.required);
      setCurrentStep(firstIncomplete >= 0 ? firstIncomplete : 0);
    } catch (error) {
      console.error('Error loading onboarding status:', error);
    }
    setLoading(false);
  }

  function handleStepComplete() {
    logMetric('onboarding_step_completed', 'user', userId, { step: steps[currentStep].id });

    const nextIncomplete = steps.findIndex((s, i) => i > currentStep && !s.completed && s.required);
    if (nextIncomplete >= 0) {
      setCurrentStep(nextIncomplete);
    } else {
      // All required steps complete
      logMetric('onboarding_completed', 'user', userId);
      onComplete?.();
    }
  }

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-700 rounded w-1/3"></div>
          <div className="h-24 bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }

  const completedCount = steps.filter(s => s.completed).length;
  const progress = (completedCount / steps.length) * 100;

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gray-900 px-6 py-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">Investor Onboarding</h2>
            <p className="text-gray-400 text-sm mt-1">
              Complete these steps to start investing
              {isDemoMode && <span className="text-amber-400 ml-2">(Demo Mode)</span>}
            </p>
          </div>
          {onClose && (
            <button onClick={onClose} className="text-gray-400 hover:text-white">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Progress bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-gray-400">{completedCount} of {steps.length} complete</span>
            <span className="text-gray-400">{Math.round(progress)}%</span>
          </div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Steps navigation */}
      <div className="px-6 py-4 border-b border-gray-700">
        <div className="flex gap-2">
          {steps.map((step, index) => (
            <button
              key={step.id}
              onClick={() => setCurrentStep(index)}
              className={`flex-1 py-2 px-3 rounded text-sm transition-colors ${
                currentStep === index
                  ? 'bg-blue-600 text-white'
                  : step.completed
                  ? 'bg-green-600/20 text-green-400'
                  : 'bg-gray-700 text-gray-400 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-2">
                {step.completed && (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
                {step.title}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="p-6">
        {currentStep === 0 && (
          <AccountSetupStep
            userId={userId}
            onComplete={handleStepComplete}
            isDemoMode={isDemoMode}
          />
        )}
        {currentStep === 1 && (
          <KYCVerificationStep
            userId={userId}
            onComplete={handleStepComplete}
            isDemoMode={isDemoMode}
          />
        )}
        {currentStep === 2 && (
          <AccreditationStep
            userId={userId}
            onComplete={handleStepComplete}
            isDemoMode={isDemoMode}
          />
        )}
        {currentStep === 3 && (
          <RiskDisclosuresStep
            userId={userId}
            onComplete={handleStepComplete}
            isDemoMode={isDemoMode}
          />
        )}
      </div>
    </div>
  );
}

// Step components
interface StepProps {
  userId: string;
  onComplete: () => void;
  isDemoMode: boolean;
}

function AccountSetupStep({ userId, onComplete, isDemoMode }: StepProps) {
  const [displayName, setDisplayName] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    try {
      await supabase
        .from('profiles')
        .update({ display_name: displayName })
        .eq('id', userId);

      onComplete();
    } catch (error) {
      console.error('Error updating profile:', error);
    }
    setSaving(false);
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-white mb-2">Account Setup</h3>
      <p className="text-gray-400 mb-6">Tell us a bit about yourself.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Display Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
            required
          />
        </div>

        <button
          type="submit"
          disabled={saving || !displayName}
          className="w-full py-2 bg-blue-600 hover:bg-blue-500 rounded text-white disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Continue'}
        </button>
      </form>
    </div>
  );
}

function KYCVerificationStep({ userId, onComplete, isDemoMode }: StepProps) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'completed'>('idle');
  const [message, setMessage] = useState('');

  async function initiateKYC() {
    setStatus('pending');
    setMessage(isDemoMode ? 'Demo verification in progress...' : 'Redirecting to verification...');

    try {
      const { data, error } = await supabase.functions.invoke('kyc-webhook/initiate', {
        body: { user_id: userId, provider: 'demo' }
      });

      if (error) throw error;

      if (isDemoMode) {
        // Wait for demo auto-approval
        setTimeout(() => {
          setStatus('completed');
          setMessage('Verification complete!');
          onComplete();
        }, 6000);
      }
    } catch (error) {
      console.error('KYC initiation error:', error);
      setMessage('Verification failed. Please try again.');
      setStatus('idle');
    }
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-white mb-2">Identity Verification</h3>
      <p className="text-gray-400 mb-6">
        We need to verify your identity to comply with regulations.
        {isDemoMode && ' This is a simulated verification in demo mode.'}
      </p>

      {status === 'idle' && (
        <button
          onClick={initiateKYC}
          className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded text-white"
        >
          Start Verification
        </button>
      )}

      {status === 'pending' && (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-400">{message}</p>
        </div>
      )}

      {status === 'completed' && (
        <div className="text-center py-8">
          <div className="text-green-400 text-6xl mb-4">✓</div>
          <p className="text-green-400">{message}</p>
        </div>
      )}
    </div>
  );
}

function AccreditationStep({ userId, onComplete, isDemoMode }: StepProps) {
  const [isAccredited, setIsAccredited] = useState<boolean | null>(null);
  const [accreditationType, setAccreditationType] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    try {
      await supabase.from('investor_accreditation').insert({
        user_id: userId,
        is_accredited: isAccredited,
        accreditation_type: isAccredited ? accreditationType : 'not_accredited',
        verification_method: 'self_certification'
      });

      onComplete();
    } catch (error) {
      console.error('Error saving accreditation:', error);
    }
    setSaving(false);
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-white mb-2">Investor Status</h3>
      <p className="text-gray-400 mb-6">
        Are you an accredited investor? This may affect your investment limits.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label className="flex items-center gap-3 p-4 bg-gray-700 rounded cursor-pointer">
            <input
              type="radio"
              name="accredited"
              checked={isAccredited === true}
              onChange={() => setIsAccredited(true)}
              className="text-blue-600"
            />
            <div>
              <div className="text-white">Yes, I am an accredited investor</div>
              <div className="text-gray-400 text-sm">Income over $200k or net worth over $1M</div>
            </div>
          </label>

          <label className="flex items-center gap-3 p-4 bg-gray-700 rounded cursor-pointer">
            <input
              type="radio"
              name="accredited"
              checked={isAccredited === false}
              onChange={() => setIsAccredited(false)}
              className="text-blue-600"
            />
            <div>
              <div className="text-white">No, I am not an accredited investor</div>
              <div className="text-gray-400 text-sm">Investment limits may apply</div>
            </div>
          </label>
        </div>

        {isAccredited === true && (
          <div>
            <label className="block text-sm text-gray-400 mb-1">Basis for accreditation</label>
            <select
              value={accreditationType}
              onChange={(e) => setAccreditationType(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
              required
            >
              <option value="">Select...</option>
              <option value="income">Income ($200k+ individual / $300k+ joint)</option>
              <option value="net_worth">Net Worth ($1M+ excluding primary residence)</option>
              <option value="professional">Professional (Series 7, 65, or 82 license)</option>
              <option value="entity">Entity with $5M+ in assets</option>
            </select>
          </div>
        )}

        <button
          type="submit"
          disabled={saving || isAccredited === null || (isAccredited && !accreditationType)}
          className="w-full py-2 bg-blue-600 hover:bg-blue-500 rounded text-white disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Continue'}
        </button>
      </form>
    </div>
  );
}

function RiskDisclosuresStep({ userId, onComplete, isDemoMode }: StepProps) {
  const [acknowledged, setAcknowledged] = useState({
    illiquidity: false,
    total_loss: false,
    no_guarantee: false
  });
  const [saving, setSaving] = useState(false);

  const disclosures = [
    {
      type: 'illiquidity',
      title: 'Illiquidity Risk',
      text: 'I understand that investments in fractional vehicle ownership are illiquid and I may not be able to sell my shares for an extended period.'
    },
    {
      type: 'total_loss',
      title: 'Loss of Investment',
      text: 'I understand that I may lose my entire investment. The value of the underlying assets can decrease, and there is no guarantee of any return.'
    },
    {
      type: 'no_guarantee',
      title: 'No Guarantee of Returns',
      text: 'I understand that past performance does not guarantee future results and there is no assurance that any investment will achieve its objectives.'
    }
  ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    try {
      const entries = Object.entries(acknowledged)
        .filter(([_, value]) => value)
        .map(([type]) => ({
          user_id: userId,
          disclosure_type: type,
          disclosure_version: '1.0'
        }));

      await supabase.from('risk_disclosure_acknowledgments').insert(entries);
      onComplete();
    } catch (error) {
      console.error('Error saving disclosures:', error);
    }
    setSaving(false);
  }

  const allAcknowledged = Object.values(acknowledged).every(Boolean);

  return (
    <div>
      <h3 className="text-lg font-semibold text-white mb-2">Risk Disclosures</h3>
      <p className="text-gray-400 mb-6">
        Please read and acknowledge the following risk disclosures before investing.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {disclosures.map((disclosure) => (
          <label
            key={disclosure.type}
            className="block p-4 bg-gray-700 rounded cursor-pointer"
          >
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={acknowledged[disclosure.type as keyof typeof acknowledged]}
                onChange={(e) => setAcknowledged(prev => ({
                  ...prev,
                  [disclosure.type]: e.target.checked
                }))}
                className="mt-1"
              />
              <div>
                <div className="text-white font-medium">{disclosure.title}</div>
                <div className="text-gray-400 text-sm mt-1">{disclosure.text}</div>
              </div>
            </div>
          </label>
        ))}

        <button
          type="submit"
          disabled={saving || !allAcknowledged}
          className="w-full py-2 bg-blue-600 hover:bg-blue-500 rounded text-white disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Complete Onboarding'}
        </button>
      </form>
    </div>
  );
}

export default InvestorOnboarding;
