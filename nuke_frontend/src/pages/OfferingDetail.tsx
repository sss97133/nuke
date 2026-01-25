/**
 * Offering Detail Page
 *
 * Per-asset LLC detail with fees, performance, subscription CTA.
 * Shows comprehensive offering information for Reg A+ investments.
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { usePlatformStatus } from '../hooks/usePlatformStatus';
import { PerformanceMetrics } from '../components/analytics/PerformanceMetrics';
import { RiskDisclosureModal } from '../components/compliance/RiskDisclosureModal';
import { useAuth } from '../hooks/useAuth';

interface Offering {
  id: string;
  offering_name: string;
  offering_description: string;
  tier: 'tier_1' | 'tier_2';
  max_offering_amount: number;
  min_investment: number;
  shares_offered: number;
  price_per_share: number;
  amount_raised: number;
  shares_sold: number;
  investor_count: number;
  offering_status: string;
  qualification_date: string | null;
  offering_circular_url: string | null;
  entity: {
    id: string;
    entity_name: string;
    entity_type: string;
    state_of_formation: string;
    vehicle_id: string | null;
  };
  fees: Array<{
    fee_type: string;
    fee_name: string;
    fee_percentage: number | null;
    fee_frequency: string;
  }>;
}

interface Vehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  sale_price: number | null;
  images: Array<{ url: string }>;
}

export default function OfferingDetail() {
  const { offeringId } = useParams<{ offeringId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isDemoMode, logMetric } = usePlatformStatus();

  const [offering, setOffering] = useState<Offering | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDisclosures, setShowDisclosures] = useState(false);
  const [investmentAmount, setInvestmentAmount] = useState('');
  const [canInvest, setCanInvest] = useState<{
    can_invest: boolean;
    issues: string[];
    is_accredited: boolean;
    disclosures_complete: boolean;
  } | null>(null);

  useEffect(() => {
    if (offeringId) {
      loadOffering();
      logMetric('offering_viewed', 'offering', offeringId);
    }
  }, [offeringId, logMetric]);

  useEffect(() => {
    if (user && offeringId && investmentAmount) {
      checkCanInvest();
    }
  }, [user, offeringId, investmentAmount]);

  async function loadOffering() {
    setLoading(true);
    try {
      // Load offering with entity and fees
      const { data: offeringData, error } = await supabase
        .from('reg_a_offerings')
        .select(`
          *,
          entity:asset_legal_entities(*),
          fees:offering_fee_schedules(*)
        `)
        .eq('id', offeringId)
        .single();

      if (error) throw error;
      setOffering(offeringData);

      // Load vehicle if linked
      if (offeringData.entity?.vehicle_id) {
        const { data: vehicleData } = await supabase
          .from('vehicles')
          .select(`
            id, year, make, model, sale_price,
            images:vehicle_images(url)
          `)
          .eq('id', offeringData.entity.vehicle_id)
          .single();

        setVehicle(vehicleData);
      }
    } catch (error) {
      console.error('Error loading offering:', error);
    }
    setLoading(false);
  }

  async function checkCanInvest() {
    if (!user || !offeringId) return;

    const amount = parseFloat(investmentAmount);
    if (isNaN(amount) || amount <= 0) return;

    const { data, error } = await supabase.rpc('can_invest_in_offering', {
      p_user_id: user.id,
      p_offering_id: offeringId,
      p_amount: amount
    });

    if (!error && data) {
      setCanInvest(data);
    }
  }

  function handleInvest() {
    if (!canInvest?.disclosures_complete) {
      setShowDisclosures(true);
      return;
    }

    // Navigate to subscription flow
    navigate(`/invest/subscribe/${offeringId}?amount=${investmentAmount}`);
  }

  function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  }

  function formatPercent(value: number): string {
    return `${(value * 100).toFixed(2)}%`;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8">
        <div className="max-w-4xl mx-auto animate-pulse">
          <div className="h-8 bg-gray-700 rounded w-1/3 mb-4"></div>
          <div className="h-48 bg-gray-700 rounded mb-6"></div>
          <div className="grid grid-cols-2 gap-6">
            <div className="h-32 bg-gray-700 rounded"></div>
            <div className="h-32 bg-gray-700 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!offering) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8">
        <div className="max-w-4xl mx-auto text-center">
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

  const sharesAvailable = offering.shares_offered - offering.shares_sold;
  const percentRaised = (offering.amount_raised / offering.max_offering_amount) * 100;
  const estimatedShares = investmentAmount
    ? (parseFloat(investmentAmount) / offering.price_per_share).toFixed(4)
    : '0';

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Hero section with vehicle image */}
      {vehicle && vehicle.images?.[0] && (
        <div
          className="h-64 bg-cover bg-center relative"
          style={{ backgroundImage: `url(${vehicle.images[0].url})` }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-gray-900 to-transparent" />
          <div className="absolute bottom-4 left-8">
            <h1 className="text-3xl font-bold">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </h1>
            <p className="text-gray-300">{offering.offering_name}</p>
          </div>
          {isDemoMode && (
            <div className="absolute top-4 right-4 bg-amber-500 text-black px-3 py-1 rounded font-bold text-sm">
              DEMO
            </div>
          )}
        </div>
      )}

      <div className="max-w-6xl mx-auto px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Offering details */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-bold mb-4">Offering Details</h2>
              <p className="text-gray-300 mb-6">{offering.offering_description}</p>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-400">Entity:</span>
                  <span className="text-white ml-2">{offering.entity?.entity_name}</span>
                </div>
                <div>
                  <span className="text-gray-400">Type:</span>
                  <span className="text-white ml-2">Reg A+ {offering.tier.replace('_', ' ').toUpperCase()}</span>
                </div>
                <div>
                  <span className="text-gray-400">State:</span>
                  <span className="text-white ml-2">{offering.entity?.state_of_formation}</span>
                </div>
                <div>
                  <span className="text-gray-400">Status:</span>
                  <span className={`ml-2 ${
                    offering.offering_status === 'open' ? 'text-green-400' : 'text-gray-400'
                  }`}>
                    {offering.offering_status.replace('_', ' ').toUpperCase()}
                  </span>
                </div>
              </div>
            </div>

            {/* Progress */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-bold mb-4">Funding Progress</h2>

              <div className="mb-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-400">{formatCurrency(offering.amount_raised)} raised</span>
                  <span className="text-gray-400">{formatCurrency(offering.max_offering_amount)} goal</span>
                </div>
                <div className="h-4 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500"
                    style={{ width: `${Math.min(100, percentRaised)}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold text-white">{offering.investor_count}</div>
                  <div className="text-gray-400 text-sm">Investors</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">{offering.shares_sold.toLocaleString()}</div>
                  <div className="text-gray-400 text-sm">Shares Sold</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">{sharesAvailable.toLocaleString()}</div>
                  <div className="text-gray-400 text-sm">Shares Available</div>
                </div>
              </div>
            </div>

            {/* Fee schedule */}
            {offering.fees && offering.fees.length > 0 && (
              <div className="bg-gray-800 rounded-lg p-6">
                <h2 className="text-xl font-bold mb-4">Fee Schedule</h2>
                <div className="space-y-3">
                  {offering.fees.map((fee, i) => (
                    <div key={i} className="flex justify-between items-center py-2 border-b border-gray-700 last:border-0">
                      <div>
                        <div className="text-white">{fee.fee_name}</div>
                        <div className="text-gray-400 text-sm capitalize">{fee.fee_frequency}</div>
                      </div>
                      <div className="text-white font-mono">
                        {fee.fee_percentage ? formatPercent(fee.fee_percentage) : '-'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Performance metrics */}
            {vehicle && (
              <PerformanceMetrics
                assetType="vehicle"
                assetId={vehicle.id}
                showBenchmarkComparison
              />
            )}
          </div>

          {/* Sidebar - Investment form */}
          <div className="lg:col-span-1">
            <div className="bg-gray-800 rounded-lg p-6 sticky top-6">
              <h2 className="text-xl font-bold mb-4">Invest Now</h2>

              {isDemoMode && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2 mb-4">
                  <span className="text-amber-400 text-sm">
                    Demo Mode: This is a simulated investment.
                  </span>
                </div>
              )}

              {/* Price per share */}
              <div className="mb-6 p-4 bg-gray-900 rounded">
                <div className="text-gray-400 text-sm">Price per Share</div>
                <div className="text-3xl font-bold font-mono">{formatCurrency(offering.price_per_share)}</div>
              </div>

              {/* Investment amount input */}
              <div className="mb-4">
                <label className="block text-gray-400 text-sm mb-2">Investment Amount (USD)</label>
                <input
                  type="number"
                  value={investmentAmount}
                  onChange={(e) => setInvestmentAmount(e.target.value)}
                  min={offering.min_investment}
                  placeholder={`Min: ${formatCurrency(offering.min_investment)}`}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-3 text-white text-lg"
                />
              </div>

              {/* Estimated shares */}
              {investmentAmount && (
                <div className="mb-6 text-sm">
                  <span className="text-gray-400">Estimated shares: </span>
                  <span className="text-white font-mono">{estimatedShares}</span>
                </div>
              )}

              {/* Investment eligibility issues */}
              {canInvest && !canInvest.can_invest && (
                <div className="mb-4 p-3 bg-red-900/20 border border-red-500/30 rounded">
                  <div className="text-red-400 text-sm font-medium mb-2">Cannot invest:</div>
                  <ul className="text-red-400 text-sm list-disc list-inside">
                    {canInvest.issues.map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Invest button */}
              <button
                onClick={handleInvest}
                disabled={
                  !user ||
                  !investmentAmount ||
                  parseFloat(investmentAmount) < offering.min_investment ||
                  offering.offering_status !== 'open'
                }
                className="w-full py-3 bg-green-600 hover:bg-green-500 rounded text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {!user
                  ? 'Sign in to Invest'
                  : offering.offering_status !== 'open'
                  ? 'Offering Closed'
                  : 'Invest Now'}
              </button>

              {/* Legal disclaimers */}
              <div className="mt-4 text-gray-500 text-xs">
                <p>
                  This is a Regulation A+ offering. Investment involves risk including
                  potential loss of principal. Review the offering circular before investing.
                </p>
                {offering.offering_circular_url && (
                  <a
                    href={offering.offering_circular_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline mt-2 inline-block"
                  >
                    View Offering Circular
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Risk disclosure modal */}
      {user && (
        <RiskDisclosureModal
          isOpen={showDisclosures}
          onClose={() => setShowDisclosures(false)}
          onComplete={() => {
            setShowDisclosures(false);
            setCanInvest(prev => prev ? { ...prev, disclosures_complete: true } : prev);
            handleInvest();
          }}
          userId={user.id}
          offeringId={offeringId}
        />
      )}
    </div>
  );
}
