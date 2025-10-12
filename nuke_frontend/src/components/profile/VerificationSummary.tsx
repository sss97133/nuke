import React from 'react';

interface VerificationSummaryProps {
  profile: any;
  onManage?: () => void;
  variant?: 'card' | 'compact';
  className?: string;
}

const VerificationSummary: React.FC<VerificationSummaryProps> = ({ profile, onManage, variant = 'card', className }) => {
  const level = (profile?.verification_level || 'unverified').replace('_', ' ');
  const phone = !!profile?.phone_verified;
  const idStatus = profile?.id_verification_status || 'n/a';
  const payment = !!profile?.payment_verified;

  if (variant === 'compact') {
    return (
      <div className={className} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="text-small font-bold" style={{ marginRight: 4 }}>Verification</span>
        <span className="badge" style={{ fontSize: 10, textTransform: 'capitalize' }}>{level}</span>
        <span className="text-small" title="Phone" style={{ color: phone ? '#059669' : '#6b7280' }}>{phone ? '✓ Phone' : 'Phone'}</span>
        <span className="text-small" title="ID" style={{ color: (idStatus === 'approved') ? '#059669' : '#6b7280' }}>{idStatus === 'approved' ? '✓ ID' : 'ID'}</span>
        <span className="text-small" title="Payment" style={{ color: payment ? '#059669' : '#6b7280' }}>{payment ? '✓ Payment' : 'Payment'}</span>
        {onManage && (
          <button className="button button-small button-secondary" onClick={onManage} style={{ marginLeft: 4 }}>Manage</button>
        )}
      </div>
    );
  }

  return (
    <div className={`card ${className || ''}`.trim()}>
      <div className="card-body">
        <h4 className="text font-bold" style={{ marginTop: 0, marginBottom: 8 }}>Verification</h4>
        <div className="vehicle-details" style={{ rowGap: 6 }}>
          <div className="vehicle-detail">
            <span>Level:</span>
            <span className="text-small">{level}</span>
          </div>
          <div className="vehicle-detail">
            <span>Phone:</span>
            <span className="text-small">{phone ? '✓ Verified' : 'Not verified'}</span>
          </div>
          <div className="vehicle-detail">
            <span>ID:</span>
            <span className="text-small">{idStatus}</span>
          </div>
          <div className="vehicle-detail">
            <span>Payment:</span>
            <span className="text-small">{payment ? '✓ On file' : 'None'}</span>
          </div>
        </div>
        {onManage && (
          <button className="button button-secondary" style={{ marginTop: 12 }} onClick={onManage}>
            Manage verification
          </button>
        )}
      </div>
    </div>
  );
};

export default VerificationSummary;
