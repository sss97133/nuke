import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface ForgotPasswordFormProps {
  onCancel: () => void;
}

const ForgotPasswordForm: React.FC<ForgotPasswordFormProps> = ({ onCancel }) => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email) {
      setError('Please enter your email address');
      return;
    }

    try {
      setError(null);
      setLoading(true);

      // Use localhost for password reset until production domain is available
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) throw error;

      setMessage('Check your email for the password reset link');
    } catch (err: any) {
      setError(err.message || 'Failed to send reset email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">Reset Password</div>
      <div className="card-body">
        <p className="text-small text-muted" style={{ marginBottom: '16px' }}>
          Enter your email address and we'll send you a link to reset your password.
        </p>

        {error && (
          <div className="alert alert-error" style={{ marginBottom: '16px' }}>
            {error}
          </div>
        )}

        {message && (
          <div className="alert alert-success" style={{ marginBottom: '16px' }}>
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label htmlFor="reset-email" className="form-label">
              Email Address
            </label>
            <input
              id="reset-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="form-input"
              placeholder="Enter your email address"
              required
              disabled={loading}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onCancel}
              className="button button-secondary"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={loading}
            >
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ForgotPasswordForm;
