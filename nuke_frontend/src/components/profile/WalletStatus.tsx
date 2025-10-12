import React from 'react';
import { supabase } from '../../lib/supabase';

interface WalletStatusProps {
  paymentVerified?: boolean;
  isOwnProfile: boolean;
}

const WalletStatus: React.FC<WalletStatusProps> = ({ paymentVerified, isOwnProfile }) => {
  const handleAddCard = async () => {
    try {
      const success_url = `${window.location.origin}/profile?payment=success`;
      const cancel_url = `${window.location.origin}/profile`;
      
      const { data, error } = await supabase.functions.invoke('create-setup-session', {
        body: { success_url, cancel_url }
      });
      
      if (error) throw error;
      if ((data as any)?.url) {
        window.location.href = (data as any).url;
      }
    } catch (error) {
      console.error('Failed to start payment setup:', error);
    }
  };

  if (!isOwnProfile) return null;

  return (
    <div className="card">
      <div className="card-body" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div>
              <div className="text-small font-bold">Wallet</div>
              <div className="text-small text-muted">
                {paymentVerified ? 'Card on file' : 'No payment method'}
              </div>
            </div>
          </div>
          {!paymentVerified && (
            <button
              className="button button-primary"
              style={{ padding: '6px 12px', fontSize: 14 }}
              onClick={handleAddCard}
            >
              Add Card
            </button>
          )}
          {paymentVerified && (
            <span style={{ color: '#10b981', fontSize: 14 }}>VERIFIED</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default WalletStatus;
