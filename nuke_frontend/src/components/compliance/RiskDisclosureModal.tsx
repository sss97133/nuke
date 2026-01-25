/**
 * Risk Disclosure Modal
 *
 * Modal for displaying and acknowledging specific risk disclosures.
 * Required before any investment action.
 */

import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { usePlatformStatus } from '../../hooks/usePlatformStatus';

interface Disclosure {
  type: string;
  title: string;
  content: string;
  required: boolean;
}

interface RiskDisclosureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  userId: string;
  offeringId?: string;
  disclosures?: Disclosure[];
  title?: string;
}

const DEFAULT_DISCLOSURES: Disclosure[] = [
  {
    type: 'illiquidity',
    title: 'Illiquidity Risk',
    content: `This investment is illiquid. Unlike stocks traded on public exchanges, you may not be able to sell your investment when you want. There is no guarantee of a secondary market for these securities. You should be prepared to hold this investment for an extended period, potentially for the life of the underlying asset.`,
    required: true
  },
  {
    type: 'total_loss',
    title: 'Risk of Total Loss',
    content: `You may lose your entire investment. The value of the underlying vehicle could decline to zero due to market conditions, damage, theft, or other factors. Past valuations do not guarantee future value. There is no insurance against investment losses.`,
    required: true
  },
  {
    type: 'no_guarantee',
    title: 'No Guarantee of Returns',
    content: `Past performance is not indicative of future results. There is no guarantee that this investment will generate positive returns, dividends, or any other income. The investment may never appreciate in value.`,
    required: true
  },
  {
    type: 'no_dividends',
    title: 'No Guaranteed Distributions',
    content: `There is no obligation to pay dividends or make distributions to investors. Any distributions are at the sole discretion of the manager and depend on asset performance, sales, or other events.`,
    required: false
  },
  {
    type: 'conflicts_of_interest',
    title: 'Conflicts of Interest',
    content: `The platform, its affiliates, and related parties may have conflicts of interest with investors. These may include fees, relationships with asset sellers, and other business interests that could affect investment decisions.`,
    required: false
  }
];

export function RiskDisclosureModal({
  isOpen,
  onClose,
  onComplete,
  userId,
  offeringId,
  disclosures = DEFAULT_DISCLOSURES,
  title = 'Risk Disclosures'
}: RiskDisclosureModalProps) {
  const { logMetric, isDemoMode } = usePlatformStatus();
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [expandedIndex, setExpandedIndex] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [typed, setTyped] = useState('');

  if (!isOpen) return null;

  const requiredDisclosures = disclosures.filter(d => d.required);
  const allRequiredAcknowledged = requiredDisclosures.every(d => acknowledged.has(d.type));

  async function handleAcknowledge() {
    if (!allRequiredAcknowledged) return;

    setSaving(true);
    logMetric('disclosures_acknowledged', 'offering', offeringId, {
      disclosure_types: Array.from(acknowledged)
    });

    try {
      const entries = Array.from(acknowledged).map(type => ({
        user_id: userId,
        offering_id: offeringId || null,
        disclosure_type: type,
        disclosure_version: '1.0',
        acknowledgment_method: 'typed_confirmation'
      }));

      const { error } = await supabase
        .from('risk_disclosure_acknowledgments')
        .upsert(entries, { onConflict: 'user_id,offering_id,disclosure_type,disclosure_version' });

      if (error) throw error;

      onComplete();
    } catch (error) {
      console.error('Error saving acknowledgments:', error);
    }

    setSaving(false);
  }

  function toggleAcknowledge(type: string) {
    const newSet = new Set(acknowledged);
    if (newSet.has(type)) {
      newSet.delete(type);
    } else {
      newSet.add(type);
    }
    setAcknowledged(newSet);
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">{title}</h2>
            <p className="text-gray-400 text-sm">
              Please read and acknowledge each risk disclosure
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Demo mode banner */}
        {isDemoMode && (
          <div className="bg-amber-500/10 border-b border-amber-500/30 px-6 py-2">
            <span className="text-amber-400 text-sm">
              Demo Mode: These are simulated disclosures for demonstration purposes.
            </span>
          </div>
        )}

        {/* Disclosures list */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {disclosures.map((disclosure, index) => (
            <div
              key={disclosure.type}
              className={`border rounded-lg overflow-hidden ${
                acknowledged.has(disclosure.type)
                  ? 'border-green-600/50 bg-green-900/10'
                  : 'border-gray-700'
              }`}
            >
              {/* Disclosure header */}
              <button
                onClick={() => setExpandedIndex(expandedIndex === index ? -1 : index)}
                className="w-full px-4 py-3 flex items-center justify-between text-left"
              >
                <div className="flex items-center gap-3">
                  {/* Checkbox */}
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleAcknowledge(disclosure.type);
                    }}
                    className={`w-5 h-5 rounded border flex items-center justify-center cursor-pointer ${
                      acknowledged.has(disclosure.type)
                        ? 'bg-green-600 border-green-600'
                        : 'border-gray-500'
                    }`}
                  >
                    {acknowledged.has(disclosure.type) && (
                      <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>

                  <div>
                    <span className="text-white font-medium">{disclosure.title}</span>
                    {disclosure.required && (
                      <span className="ml-2 text-red-400 text-xs">Required</span>
                    )}
                  </div>
                </div>

                <svg
                  className={`w-5 h-5 text-gray-400 transition-transform ${
                    expandedIndex === index ? 'rotate-180' : ''
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Disclosure content */}
              {expandedIndex === index && (
                <div className="px-4 pb-4">
                  <div className="bg-gray-900 rounded p-4 text-gray-300 text-sm leading-relaxed">
                    {disclosure.content}
                  </div>

                  {!acknowledged.has(disclosure.type) && (
                    <button
                      onClick={() => toggleAcknowledge(disclosure.type)}
                      className="mt-3 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white text-sm"
                    >
                      I acknowledge this risk
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Typed confirmation */}
        <div className="px-6 py-4 border-t border-gray-700">
          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-2">
              Type "I UNDERSTAND" to confirm you have read and understood all risks:
            </label>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value.toUpperCase())}
              placeholder="I UNDERSTAND"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleAcknowledge}
              disabled={saving || !allRequiredAcknowledged || typed !== 'I UNDERSTAND'}
              className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white disabled:opacity-50"
            >
              {saving ? 'Processing...' : 'Continue'}
            </button>
          </div>

          <p className="text-gray-500 text-xs mt-3 text-center">
            By clicking Continue, you acknowledge that you have read, understood, and agree to the above risk disclosures.
          </p>
        </div>
      </div>
    </div>
  );
}

export default RiskDisclosureModal;
