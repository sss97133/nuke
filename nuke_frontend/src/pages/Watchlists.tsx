import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  PlusIcon,
  MagnifyingGlassIcon,
  BellIcon,
  CurrencyDollarIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  PencilIcon,
  TrashIcon
} from '@heroicons/react/24/outline';
import CreateWatchlistModal from '../components/watchlist/CreateWatchlistModal';
import AutoBuyExecutionList from '../components/watchlist/AutoBuyExecutionList';

interface Watchlist {
  id: string;
  user_id: string;
  year_min: number | null;
  year_max: number | null;
  make: string | null;
  model: string | null;
  max_price: number | null;
  min_price: number | null;
  condition_preference: string | null;
  must_have_vin: boolean;
  preferred_sources: string[];
  preferred_sellers: string[];
  notify_on_new_listing: boolean;
  notify_on_price_drop: boolean;
  notify_on_ending_soon: boolean;
  auto_buy_enabled: boolean;
  auto_buy_max_price: number | null;
  auto_buy_type: string | null;
  price_drop_monitoring: boolean;
  price_drop_target: number | null;
  is_active: boolean;
  match_count: number;
  auto_buy_executions: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const Watchlists: React.FC = () => {
  const [user, setUser] = useState<any>(null);
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingWatchlist, setEditingWatchlist] = useState<Watchlist | null>(null);
  const [activeTab, setActiveTab] = useState<'watchlists' | 'executions'>('watchlists');

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (user) {
      loadWatchlists();
    }
  }, [user]);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      setUser(session.user);
    } else {
      window.location.href = '/login';
    }
  };

  const loadWatchlists = async () => {
    try {
      const { data, error } = await supabase
        .from('vehicle_watchlist')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setWatchlists(data || []);
    } catch (error: any) {
      console.error('Error loading watchlists:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this watchlist?')) return;

    try {
      const { error } = await supabase
        .from('vehicle_watchlist')
        .delete()
        .eq('id', id);

      if (error) throw error;
      loadWatchlists();
    } catch (error: any) {
      console.error('Error deleting watchlist:', error);
      alert('Failed to delete watchlist: ' + error.message);
    }
  };

  const handleToggleActive = async (watchlist: Watchlist) => {
    try {
      const { error } = await supabase
        .from('vehicle_watchlist')
        .update({ is_active: !watchlist.is_active })
        .eq('id', watchlist.id);

      if (error) throw error;
      loadWatchlists();
    } catch (error: any) {
      console.error('Error toggling watchlist:', error);
      alert('Failed to update watchlist: ' + error.message);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted">Loading watchlists...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Vehicle Watchlists</h1>
            <p className="mt-2 text-muted">
              Set up automatic buy orders and get notified when vehicles match your criteria
            </p>
          </div>
          <button
            onClick={() => {
              setEditingWatchlist(null);
              setShowCreateModal(true);
            }}
            className="btn-primary flex items-center gap-2"
          >
            <PlusIcon className="w-5 h-5" />
            Create Watchlist
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-border mb-6">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('watchlists')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'watchlists'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted hover:text-foreground hover:border-gray-300'
              }`}
            >
              Watchlists ({watchlists.length})
            </button>
            <button
              onClick={() => setActiveTab('executions')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'executions'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted hover:text-foreground hover:border-gray-300'
              }`}
            >
              Auto-Buy Executions
            </button>
          </nav>
        </div>

        {/* Content */}
        {activeTab === 'watchlists' ? (
          <div className="space-y-4">
            {watchlists.length === 0 ? (
              <div className="text-center py-12 bg-card rounded-lg border border-border">
                <MagnifyingGlassIcon className="w-12 h-12 text-muted mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">No watchlists yet</h3>
                <p className="text-muted mb-4">
                  Create your first watchlist to start tracking vehicles and setting up auto-buy orders
                </p>
                <button
                  onClick={() => {
                    setEditingWatchlist(null);
                    setShowCreateModal(true);
                  }}
                  className="btn-primary"
                >
                  Create Watchlist
                </button>
              </div>
            ) : (
              watchlists.map((watchlist) => (
                <div
                  key={watchlist.id}
                  className="bg-card rounded-lg border border-border p-6 hover:shadow-lg transition-shadow"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-3">
                        <h3 className="text-xl font-semibold text-foreground">
                          {watchlist.make && watchlist.model
                            ? `${watchlist.year_min || ''}-${watchlist.year_max || ''} ${watchlist.make} ${watchlist.model}`
                            : 'Untitled Watchlist'}
                        </h3>
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            watchlist.is_active
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {watchlist.is_active ? 'Active' : 'Inactive'}
                        </span>
                        {watchlist.auto_buy_enabled && (
                          <span className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">
                            Auto-Buy Enabled
                          </span>
                        )}
                      </div>

                      {/* Criteria */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 text-sm">
                        {watchlist.year_min && watchlist.year_max && (
                          <div>
                            <span className="text-muted">Year:</span>{' '}
                            <span className="font-medium text-foreground">
                              {watchlist.year_min}-{watchlist.year_max}
                            </span>
                          </div>
                        )}
                        {watchlist.max_price && (
                          <div>
                            <span className="text-muted">Max Price:</span>{' '}
                            <span className="font-medium text-foreground">
                              ${watchlist.max_price.toLocaleString()}
                            </span>
                          </div>
                        )}
                        {watchlist.auto_buy_max_price && (
                          <div>
                            <span className="text-muted">Auto-Buy Max:</span>{' '}
                            <span className="font-medium text-foreground">
                              ${watchlist.auto_buy_max_price.toLocaleString()}
                            </span>
                          </div>
                        )}
                        {watchlist.price_drop_target && (
                          <div>
                            <span className="text-muted">Price Drop Target:</span>{' '}
                            <span className="font-medium text-foreground">
                              ${watchlist.price_drop_target.toLocaleString()}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Stats */}
                      <div className="flex items-center gap-6 text-sm text-muted">
                        <div className="flex items-center gap-1">
                          <BellIcon className="w-4 h-4" />
                          {watchlist.match_count} matches
                        </div>
                        {watchlist.auto_buy_enabled && (
                          <div className="flex items-center gap-1">
                            <CurrencyDollarIcon className="w-4 h-4" />
                            {watchlist.auto_buy_executions} executions
                          </div>
                        )}
                        <div className="flex items-center gap-1">
                          <ClockIcon className="w-4 h-4" />
                          Created {new Date(watchlist.created_at).toLocaleDateString()}
                        </div>
                      </div>

                      {watchlist.notes && (
                        <p className="mt-3 text-sm text-muted italic">{watchlist.notes}</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 ml-4">
                      <button
                        onClick={() => handleToggleActive(watchlist)}
                        className="p-2 hover:bg-gray-100 rounded transition-colors"
                        title={watchlist.is_active ? 'Deactivate' : 'Activate'}
                      >
                        {watchlist.is_active ? (
                          <CheckCircleIcon className="w-5 h-5 text-green-600" />
                        ) : (
                          <XCircleIcon className="w-5 h-5 text-gray-400" />
                        )}
                      </button>
                      <button
                        onClick={() => {
                          setEditingWatchlist(watchlist);
                          setShowCreateModal(true);
                        }}
                        className="p-2 hover:bg-gray-100 rounded transition-colors"
                        title="Edit"
                      >
                        <PencilIcon className="w-5 h-5 text-foreground" />
                      </button>
                      <button
                        onClick={() => handleDelete(watchlist.id)}
                        className="p-2 hover:bg-red-100 rounded transition-colors"
                        title="Delete"
                      >
                        <TrashIcon className="w-5 h-5 text-red-600" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <AutoBuyExecutionList userId={user.id} />
        )}

        {/* Create/Edit Modal */}
        {showCreateModal && (
          <CreateWatchlistModal
            watchlist={editingWatchlist}
            onClose={() => {
              setShowCreateModal(false);
              setEditingWatchlist(null);
            }}
            onSuccess={() => {
              setShowCreateModal(false);
              setEditingWatchlist(null);
              loadWatchlists();
            }}
          />
        )}
      </div>
    </div>
  );
};

export default Watchlists;

