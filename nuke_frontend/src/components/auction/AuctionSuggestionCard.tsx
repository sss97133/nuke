import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface AuctionSuggestion {
  id: string;
  vehicle_id: string;
  opportunity_type: 'scheduled_lot' | 'trending_category' | 'price_match' | 'similar_sold';
  pitch_message: string;
  pitch_reason: string;
  suggested_reserve_cents: number | null;
  suggested_duration_minutes: number | null;
  confidence_score: number;
  market_data: any;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  created_at: string;
  vehicle?: {
    year: number;
    make: string;
    model: string;
  };
}

interface AuctionSuggestionCardProps {
  suggestion: AuctionSuggestion;
  onResponse?: () => void;
}

export default function AuctionSuggestionCard({ suggestion, onResponse }: AuctionSuggestionCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async () => {
    if (!confirm('Create auction listing from this suggestion?')) return;

    setLoading(true);
    setError(null);

    try {
      const { data, error: acceptError } = await supabase.rpc('accept_auction_suggestion', {
        p_suggestion_id: suggestion.id,
      });

      if (acceptError) throw acceptError;

      if (data?.success) {
        if (onResponse) onResponse();
        // Navigate to listing or show success
        window.location.href = `/listings/${data.listing_id}`;
      } else {
        setError(data?.error || 'Failed to accept suggestion');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept suggestion');
    } finally {
      setLoading(false);
    }
  };

  const handleDecline = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: declineError } = await supabase.rpc('decline_auction_suggestion', {
        p_suggestion_id: suggestion.id,
      });

      if (declineError) throw declineError;

      if (data?.success) {
        if (onResponse) onResponse();
      } else {
        setError(data?.error || 'Failed to decline suggestion');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to decline suggestion');
    } finally {
      setLoading(false);
    }
  };

  const getOpportunityIcon = () => {
    switch (suggestion.opportunity_type) {
      case 'scheduled_lot':
        return '📅';
      case 'trending_category':
        return '🔥';
      case 'similar_sold':
        return '💰';
      case 'price_match':
        return '📈';
      default:
        return '💡';
    }
  };

  const formatCurrency = (cents: number | null) => {
    if (!cents) return 'Not set';
    return `$${(cents / 100).toFixed(2)}`;
  };

  const formatDuration = (minutes: number | null) => {
    if (!minutes) return 'Not set';
    if (minutes < 60) return `${minutes} minutes`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)} hours`;
    return `${Math.floor(minutes / 1440)} days`;
  };

  if (suggestion.status !== 'pending') {
    return (
      <div className="p-4 border border-gray-200 rounded opacity-60">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">{suggestion.pitch_message}</p>
            <p className="text-xs text-gray-500 mt-1">
              {suggestion.status === 'accepted' ? '✓ Accepted' : '✗ Declined'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 border-2 border-blue-200 rounded-lg bg-blue-50">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{getOpportunityIcon()}</span>
          <div>
            <h3 className="font-semibold text-lg">Auction Opportunity</h3>
            <p className="text-sm text-gray-600">
              {suggestion.vehicle && (
                `${suggestion.vehicle.year} ${suggestion.vehicle.make} ${suggestion.vehicle.model}`
              )}
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-medium text-blue-600">
            {suggestion.confidence_score}% confidence
          </div>
        </div>
      </div>

      {/* Pitch Message */}
      <div className="mb-4">
        <p className="text-gray-800 leading-relaxed">{suggestion.pitch_message}</p>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-4 mb-4 p-3 bg-white rounded border border-gray-200">
        <div>
          <div className="text-xs text-gray-500">Suggested Reserve</div>
          <div className="font-medium">{formatCurrency(suggestion.suggested_reserve_cents)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Auction Duration</div>
          <div className="font-medium">{formatDuration(suggestion.suggested_duration_minutes)}</div>
        </div>
      </div>

      {/* Market Data */}
      {suggestion.market_data && Object.keys(suggestion.market_data).length > 0 && (
        <div className="mb-4 p-3 bg-white rounded border border-gray-200 text-sm">
          <div className="font-medium text-gray-700 mb-1">Market Insights:</div>
          {suggestion.market_data.similar_sold_price && (
            <div className="text-gray-600">
              Similar vehicle sold for {formatCurrency(suggestion.market_data.similar_sold_price)}
            </div>
          )}
          {suggestion.market_data.trending_category && (
            <div className="text-gray-600">
              {suggestion.market_data.trending_category} is trending
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={handleAccept}
          disabled={loading}
          className="flex-1 px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
        >
          {loading ? 'Processing...' : 'Yes, Create Auction'}
        </button>
        <button
          onClick={handleDecline}
          disabled={loading}
          className="px-6 py-3 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          No Thanks
        </button>
      </div>

      <p className="text-xs text-gray-500 mt-3 text-center">
        This suggestion was generated by AI based on current market trends
      </p>
    </div>
  );
}

