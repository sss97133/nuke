import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../ui/Toast';
import ConfirmModal from '../ui/ConfirmModal';

interface CreateFundingRoundProps {
  vehicleId: string;
  vehicleName: string;
  onSuccess?: () => void;
}

export default function CreateFundingRound({ vehicleId, vehicleName, onSuccess }: CreateFundingRoundProps) {
  const { showToast } = useToast();
  const [targetAmount, setTargetAmount] = useState('10000');
  const [profitSharePct, setProfitSharePct] = useState('25');
  const [minStake, setMinStake] = useState('3');
  const [description, setDescription] = useState('');
  const [deadlineDays, setDeadlineDays] = useState('30');
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSubmit = async () => {
    setShowConfirm(false);
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        showToast('Please log in to create a funding round', 'error');
        return;
      }

      const deadline = new Date();
      deadline.setDate(deadline.getDate() + parseInt(deadlineDays));

      const { data, error } = await supabase.rpc('create_funding_round', {
        p_vehicle_id: vehicleId,
        p_builder_id: user.id,
        p_target_amount_cents: Math.floor(parseFloat(targetAmount) * 100),
        p_profit_share_pct: parseFloat(profitSharePct),
        p_description: description || `Funding round for ${vehicleName}`,
        p_deadline: deadline.toISOString()
      });

      if (error) throw error;

      showToast('Funding round created successfully!', 'success');
      if (onSuccess) onSuccess();
      
      // Reset form
      setTargetAmount('10000');
      setProfitSharePct('25');
      setMinStake('3');
      setDescription('');
      setDeadlineDays('30');

    } catch (error: any) {
      console.error('Failed to create funding round:', error);
      showToast(error.message || 'Failed to create funding round', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      background: 'var(--surface)',
      border: '2px solid var(--border)',
      borderRadius: '4px',
      padding: '20px'
    }}>
      <h3 style={{
        fontSize: '10px',
        fontWeight: 600,
        marginBottom: '4px'
      }}>
        Create Funding Round
      </h3>
      <p style={{
        fontSize: '8px',
        color: 'var(--text-secondary)',
        marginBottom: '16px'
      }}>
        Raise capital for {vehicleName} restoration
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Target Amount */}
        <div>
          <label style={{
            display: 'block',
            fontSize: '9px',
            fontWeight: 600,
            marginBottom: '6px',
            color: 'var(--text)'
          }}>
            Target Amount (USD)
          </label>
          <input
            type="number"
            value={targetAmount}
            onChange={(e) => setTargetAmount(e.target.value)}
            min="100"
            step="100"
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: '9px',
              border: '2px solid var(--border)',
              borderRadius: '4px',
              background: 'var(--bg)',
              color: 'var(--text)',
              fontFamily: 'inherit'
            }}
          />
          <div style={{
            fontSize: '8px',
            color: 'var(--text-secondary)',
            marginTop: '4px'
          }}>
            How much capital do you need?
          </div>
        </div>

        {/* Profit Share % */}
        <div>
          <label style={{
            display: 'block',
            fontSize: '9px',
            fontWeight: 600,
            marginBottom: '6px',
            color: 'var(--text)'
          }}>
            Profit Share % (for stakers)
          </label>
          <input
            type="number"
            value={profitSharePct}
            onChange={(e) => setProfitSharePct(e.target.value)}
            min="1"
            max="50"
            step="0.5"
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: '9px',
              border: '2px solid var(--border)',
              borderRadius: '4px',
              background: 'var(--bg)',
              color: 'var(--text)',
              fontFamily: 'inherit'
            }}
          />
          <div style={{
            fontSize: '8px',
            color: 'var(--text-secondary)',
            marginTop: '4px'
          }}>
            What % of profit will stakers receive when sold?
          </div>
        </div>

        {/* Minimum Stake */}
        <div>
          <label style={{
            display: 'block',
            fontSize: '9px',
            fontWeight: 600,
            marginBottom: '6px',
            color: 'var(--text)'
          }}>
            Minimum Stake (USD)
          </label>
          <input
            type="number"
            value={minStake}
            onChange={(e) => setMinStake(e.target.value)}
            min="1"
            step="1"
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: '9px',
              border: '2px solid var(--border)',
              borderRadius: '4px',
              background: 'var(--bg)',
              color: 'var(--text)',
              fontFamily: 'inherit'
            }}
          />
        </div>

        {/* Description */}
        <div>
          <label style={{
            display: 'block',
            fontSize: '9px',
            fontWeight: 600,
            marginBottom: '6px',
            color: 'var(--text)'
          }}>
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What will the funds be used for? (engine rebuild, paint, interior, etc.)"
            rows={4}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: '9px',
              border: '2px solid var(--border)',
              borderRadius: '4px',
              background: 'var(--bg)',
              color: 'var(--text)',
              fontFamily: 'inherit',
              resize: 'vertical'
            }}
          />
        </div>

        {/* Deadline */}
        <div>
          <label style={{
            display: 'block',
            fontSize: '9px',
            fontWeight: 600,
            marginBottom: '6px',
            color: 'var(--text)'
          }}>
            Funding Deadline (days from now)
          </label>
          <select
            value={deadlineDays}
            onChange={(e) => setDeadlineDays(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: '9px',
              border: '2px solid var(--border)',
              borderRadius: '4px',
              background: 'var(--bg)',
              color: 'var(--text)',
              fontFamily: 'inherit'
            }}
          >
            <option value="7">7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
          </select>
        </div>

        {/* Preview */}
        <div style={{
          background: 'var(--accent-dim)',
          border: '2px solid var(--accent)',
          borderRadius: '4px',
          padding: '12px'
        }}>
          <div style={{ fontSize: '8px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
            Preview
          </div>
          <div style={{ fontSize: '9px', color: 'var(--text)', lineHeight: 1.5 }}>
            • Target: <strong>${parseFloat(targetAmount || '0').toLocaleString()}</strong><br />
            • Stakers get: <strong>{profitSharePct}%</strong> of profit<br />
            • Min stake: <strong>${minStake}</strong><br />
            • Deadline: <strong>{deadlineDays} days</strong>
          </div>
        </div>

        {/* Submit */}
        <button
          onClick={() => setShowConfirm(true)}
          disabled={loading || !targetAmount || !profitSharePct}
          style={{
            border: '2px solid var(--accent)',
            background: 'var(--accent-dim)',
            color: 'var(--accent)',
            padding: '10px 16px',
            fontSize: '9px',
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: '0.12s',
            borderRadius: '4px',
            opacity: loading ? 0.5 : 1
          }}
        >
          {loading ? 'Creating...' : 'Create Funding Round'}
        </button>
      </div>

      <ConfirmModal
        isOpen={showConfirm}
        title="Create Funding Round?"
        message={`You're about to create a funding round for ${vehicleName}. Stakers will earn ${profitSharePct}% of the profit when the vehicle sells.`}
        onConfirm={handleSubmit}
        onCancel={() => setShowConfirm(false)}
        confirmLabel="Create Round"
        type="info"
      />
    </div>
  );
}

