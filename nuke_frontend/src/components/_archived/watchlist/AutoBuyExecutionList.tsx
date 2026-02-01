import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase, SUPABASE_URL } from '../../lib/supabase';
import {
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  CurrencyDollarIcon
} from '@heroicons/react/24/outline';

interface Execution {
  id: string;
  watchlist_id: string;
  vehicle_id: string;
  external_listing_id: string | null;
  execution_type: string;
  target_price: number;
  executed_price: number;
  status: string;
  requires_confirmation: boolean;
  user_confirmed: boolean;
  bid_id: string | null;
  transaction_id: string | null;
  error_message: string | null;
  triggered_at: string;
  executed_at: string | null;
  completed_at: string | null;
  vehicles: {
    id: string;
    year: number;
    make: string;
    model: string;
  };
}

interface AutoBuyExecutionListProps {
  userId: string;
}

const AutoBuyExecutionList: React.FC<AutoBuyExecutionListProps> = ({ userId }) => {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadExecutions();
  }, [userId]);

  const loadExecutions = async () => {
    try {
      // Get executions for user's watchlists
      const { data: watchlists } = await supabase
        .from('vehicle_watchlist')
        .select('id')
        .eq('user_id', userId);

      if (!watchlists || watchlists.length === 0) {
        setLoading(false);
        return;
      }

      const watchlistIds = watchlists.map((w) => w.id);

      const { data, error } = await supabase
        .from('auto_buy_executions')
        .select(`
          *,
          vehicles(id, year, make, model)
        `)
        .in('watchlist_id', watchlistIds)
        .order('triggered_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setExecutions(data || []);
    } catch (error: any) {
      console.error('Error loading executions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (executionId: string) => {
    try {
      const { error } = await supabase
        .from('auto_buy_executions')
        .update({
          user_confirmed: true,
          user_confirmed_at: new Date().toISOString()
        })
        .eq('id', executionId);

      if (error) throw error;

      // Trigger execution via edge function
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const response = await fetch(
          `${SUPABASE_URL}/functions/v1/execute-auto-buy`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`
            },
            body: JSON.stringify({
              executionId,
              userConfirmed: true
            })
          }
        );

        if (!response.ok) {
          throw new Error('Failed to execute auto-buy');
        }
      }

      loadExecutions();
    } catch (error: any) {
      console.error('Error confirming execution:', error);
      alert('Failed to confirm execution: ' + error.message);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
        <p className="mt-4 text-muted">Loading executions...</p>
      </div>
    );
  }

  if (executions.length === 0) {
    return (
      <div className="text-center py-12 bg-card rounded-lg border border-border">
        <ClockIcon className="w-12 h-12 text-muted mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">No executions yet</h3>
        <p className="text-muted">
          Auto-buy executions will appear here when your watchlists trigger
        </p>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'executing':
        return 'bg-blue-100 text-blue-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getExecutionTypeLabel = (type: string) => {
    switch (type) {
      case 'bid_placed':
        return 'Auto-Bid';
      case 'buy_now':
        return 'Buy Now';
      case 'reserve_met_bid':
        return 'Reserve Met Bid';
      case 'price_drop_buy':
        return 'Price Drop Buy';
      default:
        return type;
    }
  };

  return (
    <div className="space-y-4">
      {executions.map((execution) => (
        <div
          key={execution.id}
          className="bg-card rounded-lg border border-border p-6 hover:shadow-lg transition-shadow"
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                <Link
                  to={`/vehicle/${execution.vehicle_id}`}
                  className="text-xl font-semibold text-foreground hover:text-primary"
                >
                  {execution.vehicles.year} {execution.vehicles.make} {execution.vehicles.model}
                </Link>
                <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(execution.status)}`}>
                  {execution.status}
                </span>
                <span className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">
                  {getExecutionTypeLabel(execution.execution_type)}
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 text-sm">
                <div>
                  <span className="text-muted">Target Price:</span>{' '}
                  <span className="font-medium text-foreground">
                    ${execution.target_price.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-muted">Executed Price:</span>{' '}
                  <span className="font-medium text-foreground">
                    ${execution.executed_price.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-muted">Triggered:</span>{' '}
                  <span className="font-medium text-foreground">
                    {new Date(execution.triggered_at).toLocaleString()}
                  </span>
                </div>
                {execution.completed_at && (
                  <div>
                    <span className="text-muted">Completed:</span>{' '}
                    <span className="font-medium text-foreground">
                      {new Date(execution.completed_at).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>

              {execution.error_message && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
                  <strong>Error:</strong> {execution.error_message}
                </div>
              )}

              {execution.status === 'pending' && execution.requires_confirmation && !execution.user_confirmed && (
                <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
                  <p className="text-sm text-yellow-800 mb-2">
                    This auto-buy requires your confirmation before executing.
                  </p>
                  <button
                    onClick={() => handleConfirm(execution.id)}
                    className="btn-primary text-sm px-4 py-2"
                  >
                    Confirm & Execute
                  </button>
                </div>
              )}
            </div>

            <div className="ml-4">
              {execution.status === 'completed' ? (
                <CheckCircleIcon className="w-8 h-8 text-green-600" />
              ) : execution.status === 'failed' ? (
                <XCircleIcon className="w-8 h-8 text-red-600" />
              ) : (
                <ClockIcon className="w-8 h-8 text-yellow-600" />
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default AutoBuyExecutionList;

