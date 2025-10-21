import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { CreditsService } from '../services/creditsService';

export default function CreditsSuccess() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const sessionId = searchParams.get('session_id');

  useEffect(() => {
    loadBalance();
  }, []);

  const loadBalance = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const userBalance = await CreditsService.getUserBalance(user.id);
        setBalance(userBalance);
      }
    } catch (error) {
      console.error('Failed to load balance:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      color: 'var(--text)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px'
    }}>
      <div style={{
        maxWidth: '500px',
        width: '100%',
        background: 'var(--surface)',
        border: '2px solid var(--border)',
        borderRadius: '8px',
        padding: '32px',
        textAlign: 'center'
      }}>
        {/* Success Icon */}
        <div style={{
          width: '64px',
          height: '64px',
          margin: '0 auto 24px',
          background: 'var(--success-dim)',
          border: '2px solid var(--success)',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '32px'
        }}>
          ✓
        </div>

        {/* Title */}
        <h1 style={{
          fontSize: '24px',
          fontWeight: 700,
          marginBottom: '12px',
          color: 'var(--text)'
        }}>
          Payment Successful!
        </h1>

        {/* Message */}
        <p style={{
          fontSize: '14px',
          color: 'var(--text-secondary)',
          marginBottom: '24px',
          lineHeight: 1.5
        }}>
          Your credits have been added to your account. You can now use them to support vehicles and builders on the platform.
        </p>

        {/* Balance Display */}
        {!loading && (
          <div style={{
            background: 'var(--accent-dim)',
            border: '2px solid var(--accent)',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '24px'
          }}>
            <div style={{
              fontSize: '11px',
              fontWeight: 600,
              textTransform: 'uppercase',
              color: 'var(--accent)',
              marginBottom: '8px'
            }}>
              Current Balance
            </div>
            <div style={{
              fontSize: '32px',
              fontWeight: 700,
              color: 'var(--accent)',
              fontFamily: 'var(--font-mono, monospace)'
            }}>
              {CreditsService.formatCredits(balance)}
            </div>
            <div style={{
              fontSize: '10px',
              color: 'var(--text-secondary)',
              marginTop: '4px'
            }}>
              {balance} credits
            </div>
          </div>
        )}

        {/* Session Info */}
        {sessionId && (
          <div style={{
            fontSize: '10px',
            color: 'var(--text-secondary)',
            marginBottom: '24px',
            fontFamily: 'var(--font-mono, monospace)',
            wordBreak: 'break-all'
          }}>
            Transaction ID: {sessionId.substring(0, 20)}...
          </div>
        )}

        {/* Actions */}
        <div style={{
          display: 'flex',
          gap: '12px',
          flexDirection: 'column'
        }}>
          <button
            onClick={() => navigate('/credits')}
            style={{
              border: '2px solid var(--accent)',
              background: 'var(--accent-dim)',
              color: 'var(--accent)',
              padding: '12px 24px',
              fontSize: '13px',
              fontWeight: 600,
              fontFamily: 'Arial, sans-serif',
              cursor: 'pointer',
              transition: '0.12s',
              borderRadius: '4px',
              width: '100%'
            }}
          >
            View Credit History
          </button>

          <button
            onClick={() => navigate('/')}
            style={{
              border: '2px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              padding: '12px 24px',
              fontSize: '13px',
              fontWeight: 600,
              fontFamily: 'Arial, sans-serif',
              cursor: 'pointer',
              transition: '0.12s',
              borderRadius: '4px',
              width: '100%'
            }}
          >
            Return to Home
          </button>
        </div>
      </div>
    </div>
  );
}

