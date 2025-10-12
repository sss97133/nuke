/**
 * CONSOLIDATED PASSWORD CHANGE COMPONENT
 *
 * This component replaces the redundant PasswordChangeForm.tsx.
 *
 * Features:
 * - Field-specific error validation
 * - Current password verification
 * - Comprehensive form validation
 * - Success/error state handling
 * - Password requirements display
 */

import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface ChangePasswordFormProps {
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

const ChangePasswordForm: React.FC<ChangePasswordFormProps> = ({ onSuccess, onError }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{[key: string]: string}>({});
  const [successMessage, setSuccessMessage] = useState('');

  const validateForm = () => {
    const newErrors: {[key: string]: string} = {};

    if (!currentPassword) {
      newErrors.currentPassword = 'Current password is required';
    }

    if (!newPassword) {
      newErrors.newPassword = 'New password is required';
    } else if (newPassword.length < 6) {
      newErrors.newPassword = 'New password must be at least 6 characters';
    }

    if (!confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your new password';
    } else if (newPassword !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    if (currentPassword && newPassword && currentPassword === newPassword) {
      newErrors.newPassword = 'New password must be different from current password';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setSuccessMessage('');
    setErrors({});

    try {
      // First verify the current password by attempting to sign in
      const { data: user } = await supabase.auth.getUser();
      if (!user.user?.email) {
        throw new Error('User not found');
      }

      // Verify current password by creating a temporary session
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: user.user.email,
        password: currentPassword,
      });

      if (verifyError) {
        if (verifyError.message.includes('Invalid login credentials')) {
          setErrors({ currentPassword: 'Current password is incorrect' });
        } else {
          setErrors({ general: verifyError.message });
        }
        return;
      }

      // Update password
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (updateError) {
        throw updateError;
      }

      setSuccessMessage('Password updated successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      
      if (onSuccess) {
        onSuccess();
      }

    } catch (error: any) {
      const errorMessage = error.message || 'Failed to update password';
      setErrors({ general: errorMessage });
      
      if (onError) {
        onError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="card-body">
        <h3 className="text font-bold" style={{ marginBottom: '16px' }}>Change Password</h3>
        
        {successMessage && (
          <div style={{
            padding: '12px',
            backgroundColor: '#d1fae5',
            border: '1px solid #10b981',
            borderRadius: '4px',
            marginBottom: '16px',
            color: '#065f46'
          }}>
            {successMessage}
          </div>
        )}

        {errors.general && (
          <div style={{
            padding: '12px',
            backgroundColor: '#fee2e2',
            border: '1px solid #ef4444',
            borderRadius: '4px',
            marginBottom: '16px',
            color: '#991b1b'
          }}>
            {errors.general}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="currentPassword" className="form-label">
              Current Password
            </label>
            <input
              type="password"
              id="currentPassword"
              className={`form-input ${errors.currentPassword ? 'error' : ''}`}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              disabled={loading}
              autoComplete="current-password"
            />
            {errors.currentPassword && (
              <div className="form-error">{errors.currentPassword}</div>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="newPassword" className="form-label">
              New Password
            </label>
            <input
              type="password"
              id="newPassword"
              className={`form-input ${errors.newPassword ? 'error' : ''}`}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={loading}
              autoComplete="new-password"
              minLength={6}
            />
            {errors.newPassword && (
              <div className="form-error">{errors.newPassword}</div>
            )}
            <div className="text-small text-muted" style={{ marginTop: '4px' }}>
              Must be at least 6 characters long
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword" className="form-label">
              Confirm New Password
            </label>
            <input
              type="password"
              id="confirmPassword"
              className={`form-input ${errors.confirmPassword ? 'error' : ''}`}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
              autoComplete="new-password"
            />
            {errors.confirmPassword && (
              <div className="form-error">{errors.confirmPassword}</div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '24px' }}>
            <button
              type="submit"
              className="button button-primary"
              disabled={loading}
            >
              {loading ? 'Updating...' : 'Update Password'}
            </button>
            
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setCurrentPassword('');
                setNewPassword('');
                setConfirmPassword('');
                setErrors({});
                setSuccessMessage('');
              }}
              disabled={loading}
            >
              Clear
            </button>
          </div>
        </form>

        <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#f8fafc', borderRadius: '4px' }}>
          <h4 className="text-small font-bold" style={{ marginBottom: '8px' }}>Password Requirements:</h4>
          <ul className="text-small text-muted" style={{ margin: 0, paddingLeft: '16px' }}>
            <li>At least 6 characters long</li>
            <li>Different from your current password</li>
            <li>Consider using a mix of letters, numbers, and symbols</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default ChangePasswordForm;
