import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface Subscription {
  id: string;
  subscription_type: string;
  target_id?: string;
  filters?: any;
  is_active: boolean;
  created_at: string;
}

interface Props {
  userId: string;
}

const NotificationSubscriptionManager: React.FC<Props> = ({ userId }) => {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSubType, setNewSubType] = useState('dealer_new_listings');
  const [dealers, setDealers] = useState<Array<{ id: string; business_name: string }>>([]);
  const [selectedDealer, setSelectedDealer] = useState('');

  useEffect(() => {
    loadSubscriptions();
    loadDealers();
  }, [userId]);

  const loadSubscriptions = async () => {
    const { data, error } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setSubscriptions(data);
    }
  };

  const loadDealers = async () => {
    const { data, error } = await supabase
      .from('businesses')
      .select('id, business_name')
      .eq('business_type', 'dealership')
      .order('business_name');

    if (!error && data) {
      setDealers(data);
    }
  };

  const handleSubscribe = async () => {
    if (newSubType === 'dealer_new_listings' && !selectedDealer) {
      alert('Please select a dealer');
      return;
    }

    try {
      const { error } = await supabase
        .from('user_subscriptions')
        .insert({
          user_id: userId,
          subscription_type: newSubType,
          target_id: newSubType === 'dealer_new_listings' ? selectedDealer : null,
          is_active: true
        });

      if (error) throw error;

      alert('Subscription added! You\'ll be notified when new vehicles are listed.');
      loadSubscriptions();
      setShowAddForm(false);
      setSelectedDealer('');
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    }
  };

  const toggleSubscription = async (id: string, currentStatus: boolean) => {
    const { error } = await supabase
      .from('user_subscriptions')
      .update({ is_active: !currentStatus })
      .eq('id', id);

    if (!error) {
      loadSubscriptions();
    }
  };

  const deleteSubscription = async (id: string) => {
    if (!confirm('Delete this notification subscription?')) return;

    const { error } = await supabase
      .from('user_subscriptions')
      .delete()
      .eq('id', id);

    if (!error) {
      loadSubscriptions();
    }
  };

  const getSubscriptionLabel = (sub: Subscription): string => {
    if (sub.subscription_type === 'dealer_new_listings' && sub.target_id) {
      const dealer = dealers.find(d => d.id === sub.target_id);
      return `New listings from ${dealer?.business_name || 'dealer'}`;
    }
    
    return sub.subscription_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  return (
    <div className="card">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '11pt', fontWeight: 700 }}>
          Notification Subscriptions
        </h3>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="button button-small button-primary"
          style={{ fontSize: '8pt' }}
        >
          + Add Subscription
        </button>
      </div>
      <div className="card-body">
        {/* Add Form */}
        {showAddForm && (
          <div style={{
            padding: '12px',
            marginBottom: '16px',
            border: '2px solid var(--accent)',
            borderRadius: '4px',
            background: 'rgba(59, 130, 246, 0.05)'
          }}>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '9pt', fontWeight: 600 }}>
                Notification Type
              </label>
              <select
                value={newSubType}
                onChange={(e) => setNewSubType(e.target.value)}
                className="form-input"
                style={{ width: '100%', fontSize: '9pt' }}
              >
                <option value="dealer_new_listings">Dealer New Listings</option>
                <option value="dealer_price_drops">Price Drops</option>
                <option value="auction_starting">Auction Announcements</option>
                <option value="make_model">Make/Model Alerts</option>
                <option value="price_range">Price Range</option>
              </select>
            </div>

            {newSubType === 'dealer_new_listings' && (
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '9pt', fontWeight: 600 }}>
                  Select Dealer
                </label>
                <select
                  value={selectedDealer}
                  onChange={(e) => setSelectedDealer(e.target.value)}
                  className="form-input"
                  style={{ width: '100%', fontSize: '9pt' }}
                >
                  <option value="">Choose a dealer...</option>
                  {dealers.map(dealer => (
                    <option key={dealer.id} value={dealer.id}>
                      {dealer.business_name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleSubscribe}
                className="button button-primary"
                style={{ fontSize: '9pt' }}
              >
                Subscribe
              </button>
              <button
                onClick={() => setShowAddForm(false)}
                className="button button-secondary"
                style={{ fontSize: '9pt' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Existing Subscriptions */}
        {subscriptions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '9pt' }}>
            No notification subscriptions yet. Click "Add Subscription" to get notified when vehicles are listed!
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {subscriptions.map(sub => (
              <div
                key={sub.id}
                style={{
                  padding: '12px',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: sub.is_active ? 'var(--white)' : 'var(--background-secondary)',
                  opacity: sub.is_active ? 1 : 0.6
                }}
              >
                <div>
                  <div style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '2px' }}>
                    {getSubscriptionLabel(sub)}
                  </div>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                    {sub.is_active ? 'Active' : 'Paused'} • Since {new Date(sub.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    onClick={() => toggleSubscription(sub.id, sub.is_active)}
                    className="button button-small"
                    style={{ fontSize: '8pt' }}
                  >
                    {sub.is_active ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    onClick={() => deleteSubscription(sub.id)}
                    className="button button-small button-secondary"
                    style={{ fontSize: '8pt', color: 'var(--color-danger)' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Info */}
        <div style={{
          marginTop: '16px',
          padding: '12px',
          background: 'var(--background-secondary)',
          borderRadius: '4px',
          fontSize: '8pt',
          color: 'var(--text-muted)'
        }}>
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>How it works:</div>
          <ul style={{ margin: 0, paddingLeft: '20px' }}>
            <li>Subscribe to dealers (like Viva) to get notified when they list new vehicles</li>
            <li>Get alerts when prices drop on vehicles you're watching</li>
            <li>Be notified when vehicles go to auction (BaT, Cars & Bids, etc.)</li>
            <li>Set up make/model alerts to catch specific vehicles you're hunting for</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default NotificationSubscriptionManager;

