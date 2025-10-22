import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../ui/Toast';
import ConfirmModal from '../ui/ConfirmModal';

interface IssueBondFormProps {
  vehicleId: string;
  vehicleName: string;
  onSuccess?: () => void;
}

export default function IssueBondForm({ vehicleId, vehicleName, onSuccess }: IssueBondFormProps) {
  const { showToast } = useToast();
  const [principal, setPrincipal] = useState('5000');
  const [interestRate, setInterestRate] = useState('8');
  const [termMonths, setTermMonths] = useState('24');
  const [paymentSchedule, setPaymentSchedule] = useState('at_maturity');
  const [useOfFunds, setUseOfFunds] = useState('');
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const calculateReturn = () => {
    const p = parseFloat(principal || '0');
    const r = parseFloat(interestRate || '0') / 100;
    const years = parseInt(termMonths || '0') / 12;
    const interest = p * r * years;
    return {
      interest: interest,
      total: p + interest
    };
  };

  const returns = calculateReturn();

  const handleSubmit = async () => {
    setShowConfirm(false);
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        showToast('Please log in to issue a bond', 'error');
        return;
      }

      const maturityDate = new Date();
      maturityDate.setMonth(maturityDate.getMonth() + parseInt(termMonths));

      const { data, error } = await supabase
        .from('vehicle_bonds')
        .insert({
          vehicle_id: vehicleId,
          issuer_id: user.id,
          principal_cents: Math.floor(parseFloat(principal) * 100),
          interest_rate: parseFloat(interestRate),
          term_months: parseInt(termMonths),
          payment_schedule: paymentSchedule,
          maturity_date: maturityDate.toISOString(),
          status: 'active',
          metadata: {
            use_of_funds: useOfFunds || 'Vehicle restoration and improvements'
          }
        })
        .select()
        .single();

      if (error) throw error;

      showToast('Bond issued successfully!', 'success');
      if (onSuccess) onSuccess();
      
      // Reset form
      setPrincipal('5000');
      setInterestRate('8');
      setTermMonths('24');
      setPaymentSchedule('at_maturity');
      setUseOfFunds('');

    } catch (error: any) {
      console.error('Failed to issue bond:', error);
      showToast(error.message || 'Failed to issue bond', 'error');
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
        Issue Vehicle Bond
      </h3>
      <p style={{
        fontSize: '8px',
        color: 'var(--text-secondary)',
        marginBottom: '16px'
      }}>
        Raise debt capital with fixed interest for {vehicleName}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Principal Amount */}
        <div>
          <label style={{
            display: 'block',
            fontSize: '9px',
            fontWeight: 600,
            marginBottom: '6px',
            color: 'var(--text)'
          }}>
            Principal Amount (USD)
          </label>
          <input
            type="number"
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
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
            Total amount to borrow
          </div>
        </div>

        {/* Interest Rate */}
        <div>
          <label style={{
            display: 'block',
            fontSize: '9px',
            fontWeight: 600,
            marginBottom: '6px',
            color: 'var(--text)'
          }}>
            Interest Rate (% per year)
          </label>
          <input
            type="number"
            value={interestRate}
            onChange={(e) => setInterestRate(e.target.value)}
            min="1"
            max="20"
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
        </div>

        {/* Term */}
        <div>
          <label style={{
            display: 'block',
            fontSize: '9px',
            fontWeight: 600,
            marginBottom: '6px',
            color: 'var(--text)'
          }}>
            Term (months)
          </label>
          <select
            value={termMonths}
            onChange={(e) => setTermMonths(e.target.value)}
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
            <option value="12">12 months (1 year)</option>
            <option value="24">24 months (2 years)</option>
            <option value="36">36 months (3 years)</option>
            <option value="48">48 months (4 years)</option>
          </select>
        </div>

        {/* Payment Schedule */}
        <div>
          <label style={{
            display: 'block',
            fontSize: '9px',
            fontWeight: 600,
            marginBottom: '6px',
            color: 'var(--text)'
          }}>
            Payment Schedule
          </label>
          <select
            value={paymentSchedule}
            onChange={(e) => setPaymentSchedule(e.target.value)}
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
            <option value="at_maturity">At Maturity (all at end)</option>
            <option value="quarterly">Quarterly Payments</option>
            <option value="monthly">Monthly Payments</option>
          </select>
        </div>

        {/* Use of Funds */}
        <div>
          <label style={{
            display: 'block',
            fontSize: '9px',
            fontWeight: 600,
            marginBottom: '6px',
            color: 'var(--text)'
          }}>
            Use of Funds
          </label>
          <textarea
            value={useOfFunds}
            onChange={(e) => setUseOfFunds(e.target.value)}
            placeholder="How will the borrowed money be used?"
            rows={3}
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

        {/* Preview */}
        <div style={{
          background: 'var(--accent-dim)',
          border: '2px solid var(--accent)',
          borderRadius: '4px',
          padding: '12px'
        }}>
          <div style={{ fontSize: '8px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
            Bond Terms Preview
          </div>
          <div style={{ fontSize: '9px', color: 'var(--text)', lineHeight: 1.5 }}>
            • Principal: <strong>${parseFloat(principal || '0').toLocaleString()}</strong><br />
            • Interest: <strong>{interestRate}%</strong> per year<br />
            • Term: <strong>{termMonths} months</strong><br />
            • Total Interest: <strong>${returns.interest.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><br />
            • Total Payback: <strong>${returns.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          </div>
        </div>

        {/* Submit */}
        <button
          onClick={() => setShowConfirm(true)}
          disabled={loading || !principal || !interestRate}
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
          {loading ? 'Issuing...' : 'Issue Bond'}
        </button>
      </div>

      <ConfirmModal
        isOpen={showConfirm}
        title="Issue Vehicle Bond?"
        message={`You're about to borrow $${parseFloat(principal || '0').toLocaleString()} at ${interestRate}% interest. You'll need to repay $${returns.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} over ${termMonths} months.`}
        amount={Math.floor(parseFloat(principal || '0') * 100)}
        onConfirm={handleSubmit}
        onCancel={() => setShowConfirm(false)}
        confirmLabel="Issue Bond"
        type="warning"
      />
    </div>
  );
}

