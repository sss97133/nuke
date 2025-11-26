import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface Watchlist {
  id?: string;
  year_min?: number | null;
  year_max?: number | null;
  make?: string | null;
  model?: string | null;
  max_price?: number | null;
  min_price?: number | null;
  condition_preference?: string | null;
  must_have_vin?: boolean;
  preferred_sources?: string[];
  preferred_sellers?: string[];
  notify_on_new_listing?: boolean;
  notify_on_price_drop?: boolean;
  notify_on_ending_soon?: boolean;
  auto_buy_enabled?: boolean;
  auto_buy_max_price?: number | null;
  auto_buy_type?: string | null;
  auto_buy_bid_increment?: number | null;
  auto_buy_max_bid?: number | null;
  auto_buy_requires_confirmation?: boolean;
  price_drop_monitoring?: boolean;
  price_drop_target?: number | null;
  is_active?: boolean;
  notes?: string | null;
}

interface CreateWatchlistModalProps {
  watchlist?: Watchlist | null;
  onClose: () => void;
  onSuccess: () => void;
}

const CreateWatchlistModal: React.FC<CreateWatchlistModalProps> = ({
  watchlist,
  onClose,
  onSuccess
}) => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<Watchlist>({
    year_min: watchlist?.year_min || null,
    year_max: watchlist?.year_max || null,
    make: watchlist?.make || '',
    model: watchlist?.model || '',
    max_price: watchlist?.max_price || null,
    min_price: watchlist?.min_price || null,
    condition_preference: watchlist?.condition_preference || 'any',
    must_have_vin: watchlist?.must_have_vin || false,
    preferred_sources: watchlist?.preferred_sources || [],
    preferred_sellers: watchlist?.preferred_sellers || [],
    notify_on_new_listing: watchlist?.notify_on_new_listing ?? true,
    notify_on_price_drop: watchlist?.notify_on_price_drop ?? false,
    notify_on_ending_soon: watchlist?.notify_on_ending_soon ?? false,
    auto_buy_enabled: watchlist?.auto_buy_enabled ?? false,
    auto_buy_max_price: watchlist?.auto_buy_max_price || null,
    auto_buy_type: watchlist?.auto_buy_type || 'bid',
    auto_buy_bid_increment: watchlist?.auto_buy_bid_increment || 100,
    auto_buy_max_bid: watchlist?.auto_buy_max_bid || null,
    auto_buy_requires_confirmation: watchlist?.auto_buy_requires_confirmation ?? true,
    price_drop_monitoring: watchlist?.price_drop_monitoring ?? false,
    price_drop_target: watchlist?.price_drop_target || null,
    is_active: watchlist?.is_active ?? true,
    notes: watchlist?.notes || ''
  });

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      setUser(session.user);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setLoading(true);
    try {
      const payload: any = {
        user_id: user.id,
        year_min: formData.year_min || null,
        year_max: formData.year_max || null,
        make: formData.make || null,
        model: formData.model || null,
        max_price: formData.max_price || null,
        min_price: formData.min_price || null,
        condition_preference: formData.condition_preference || 'any',
        must_have_vin: formData.must_have_vin || false,
        preferred_sources: formData.preferred_sources || [],
        preferred_sellers: formData.preferred_sellers || [],
        notify_on_new_listing: formData.notify_on_new_listing ?? true,
        notify_on_price_drop: formData.notify_on_price_drop ?? false,
        notify_on_ending_soon: formData.notify_on_ending_soon ?? false,
        auto_buy_enabled: formData.auto_buy_enabled ?? false,
        auto_buy_max_price: formData.auto_buy_max_price || null,
        auto_buy_type: formData.auto_buy_type || null,
        auto_buy_bid_increment: formData.auto_buy_bid_increment || 100,
        auto_buy_max_bid: formData.auto_buy_max_bid || null,
        auto_buy_requires_confirmation: formData.auto_buy_requires_confirmation ?? true,
        price_drop_monitoring: formData.price_drop_monitoring ?? false,
        price_drop_target: formData.price_drop_target || null,
        is_active: formData.is_active ?? true,
        notes: formData.notes || null
      };

      if (watchlist?.id) {
        const { error } = await supabase
          .from('vehicle_watchlist')
          .update(payload)
          .eq('id', watchlist.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('vehicle_watchlist')
          .insert(payload);
        if (error) throw error;
      }

      onSuccess();
    } catch (error: any) {
      console.error('Error saving watchlist:', error);
      alert('Failed to save watchlist: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-lg border border-border max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-foreground">
            {watchlist?.id ? 'Edit Watchlist' : 'Create Watchlist'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded transition-colors"
          >
            <XMarkIcon className="w-6 h-6 text-foreground" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Basic Criteria */}
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-4">Vehicle Criteria</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Year (Min)
                </label>
                <input
                  type="number"
                  value={formData.year_min || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, year_min: e.target.value ? parseInt(e.target.value) : null })
                  }
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
                  placeholder="1950"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Year (Max)
                </label>
                <input
                  type="number"
                  value={formData.year_max || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, year_max: e.target.value ? parseInt(e.target.value) : null })
                  }
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
                  placeholder="2024"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Make
                </label>
                <input
                  type="text"
                  value={formData.make || ''}
                  onChange={(e) => setFormData({ ...formData, make: e.target.value || null })}
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
                  placeholder="Citroen"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Model
                </label>
                <input
                  type="text"
                  value={formData.model || ''}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value || null })}
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
                  placeholder="2CV"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Max Price ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.max_price || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, max_price: e.target.value ? parseFloat(e.target.value) : null })
                  }
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
                  placeholder="50000"
                />
              </div>
              <div>
                <label className="flex items-center gap-2 mt-6">
                  <input
                    type="checkbox"
                    checked={formData.must_have_vin || false}
                    onChange={(e) => setFormData({ ...formData, must_have_vin: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm text-foreground">Must have VIN</span>
                </label>
              </div>
            </div>
          </div>

          {/* Auto-Buy Settings */}
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-4">Auto-Buy Settings</h3>
            <div className="space-y-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.auto_buy_enabled || false}
                  onChange={(e) => setFormData({ ...formData, auto_buy_enabled: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm font-medium text-foreground">Enable Auto-Buy</span>
              </label>

              {formData.auto_buy_enabled && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        Auto-Buy Max Price ($)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.auto_buy_max_price || ''}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            auto_buy_max_price: e.target.value ? parseFloat(e.target.value) : null
                          })
                        }
                        className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
                        placeholder="45000"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        Auto-Buy Type
                      </label>
                      <select
                        value={formData.auto_buy_type || 'bid'}
                        onChange={(e) => setFormData({ ...formData, auto_buy_type: e.target.value })}
                        className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
                      >
                        <option value="bid">Auto-Bid (Auctions)</option>
                        <option value="buy_now">Buy Now</option>
                        <option value="reserve_met">When Reserve Met</option>
                      </select>
                    </div>
                  </div>

                  {formData.auto_buy_type === 'bid' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-2">
                          Bid Increment ($)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={formData.auto_buy_bid_increment || 100}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              auto_buy_bid_increment: e.target.value ? parseFloat(e.target.value) : 100
                            })
                          }
                          className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-2">
                          Max Bid ($)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={formData.auto_buy_max_bid || ''}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              auto_buy_max_bid: e.target.value ? parseFloat(e.target.value) : null
                            })
                          }
                          className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
                          placeholder="50000"
                        />
                      </div>
                    </div>
                  )}

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.auto_buy_requires_confirmation ?? true}
                      onChange={(e) =>
                        setFormData({ ...formData, auto_buy_requires_confirmation: e.target.checked })
                      }
                      className="rounded"
                    />
                    <span className="text-sm text-foreground">Require confirmation before executing</span>
                  </label>
                </>
              )}

              {/* Price Drop Monitoring */}
              <div className="border-t border-border pt-4">
                <label className="flex items-center gap-2 mb-4">
                  <input
                    type="checkbox"
                    checked={formData.price_drop_monitoring || false}
                    onChange={(e) => setFormData({ ...formData, price_drop_monitoring: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm font-medium text-foreground">Price Drop Monitoring (Limit Order)</span>
                </label>

                {formData.price_drop_monitoring && (
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Auto-Buy When Price Drops To ($)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.price_drop_target || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          price_drop_target: e.target.value ? parseFloat(e.target.value) : null
                        })
                      }
                      className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
                      placeholder="25000"
                    />
                    <p className="mt-2 text-xs text-muted">
                      Like a limit buy order - automatically executes when price hits this target
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Notification Settings */}
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-4">Notifications</h3>
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.notify_on_new_listing ?? true}
                  onChange={(e) => setFormData({ ...formData, notify_on_new_listing: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm text-foreground">Notify on new listing</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.notify_on_price_drop || false}
                  onChange={(e) => setFormData({ ...formData, notify_on_price_drop: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm text-foreground">Notify on price drop</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.notify_on_ending_soon || false}
                  onChange={(e) => setFormData({ ...formData, notify_on_ending_soon: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm text-foreground">Notify when auction ending soon</span>
              </label>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Notes</label>
            <textarea
              value={formData.notes || ''}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
              placeholder="Optional notes about this watchlist..."
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-border rounded-md text-foreground hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary px-4 py-2"
            >
              {loading ? 'Saving...' : watchlist?.id ? 'Update Watchlist' : 'Create Watchlist'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateWatchlistModal;

