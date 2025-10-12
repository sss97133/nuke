import React, { useState, useEffect } from 'react';
import PurchaseAgreementCreator from './PurchaseAgreementCreator';
import DigitalSignature from './DigitalSignature';

interface Vehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  vin: string;
  color: string;
  mileage: number;
  user_id: string;
  current_value?: number;
}

interface PurchaseAgreement {
  id: string;
  status: 'draft' | 'pending_buyer' | 'pending_signatures' | 'completed' | 'cancelled';
  vehicle_sales_price: number;
  seller_name: string;
  buyer_name?: string;
  buyer_user_id?: string;
  total_gross_proceeds: number;
  balance_due: number;
  agreement_date: string;
  signature_status: {
    buyer_signed: boolean;
    seller_signed: boolean;
    co_buyer_signed: boolean;
  };
  vehicle_info: {
    year: number;
    make: string;
    model: string;
    vin: string;
    color: string;
    mileage: number;
  };
}

interface PurchaseAgreementManagerProps {
  vehicle: Vehicle;
  userProfile: {
    id: string;
    full_name: string;
    email: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  canCreateAgreement?: boolean;
}

export default function PurchaseAgreementManager({
  vehicle,
  userProfile,
  canCreateAgreement = true
}: PurchaseAgreementManagerProps) {
  const [agreements, setAgreements] = useState<PurchaseAgreement[]>([]);
  const [selectedAgreement, setSelectedAgreement] = useState<PurchaseAgreement | null>(null);
  const [showCreator, setShowCreator] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadExistingAgreements();
  }, [vehicle.id]);

  const loadExistingAgreements = async () => {
    setLoading(true);
    try {
      // In a real implementation, you might have an endpoint to get agreements by vehicle
      // For now, we'll assume they're loaded via another method
      setLoading(false);
    } catch (error) {
      console.error('Error loading agreements:', error);
      setLoading(false);
    }
  };

  const handleAgreementCreated = (agreement: PurchaseAgreement) => {
    setAgreements(prev => [...prev, agreement]);
    setSelectedAgreement(agreement);
    setShowCreator(false);
  };

  const handleSignatureCompleted = (signature: any) => {
    // Refresh the agreement data
    if (selectedAgreement) {
      console.log('Signature completed:', signature);
      setShowSignature(false);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-body text-center">Loading purchase agreements...</div>
      </div>
    );
  }

  if (showCreator) {
    return (
      <div>
        <div style={{ marginBottom: '16px' }}>
          <button onClick={() => setShowCreator(false)} className="button button-secondary">
            ← Back to Agreements
          </button>
        </div>
        <PurchaseAgreementCreator
          vehicle={vehicle}
          userProfile={userProfile}
          onAgreementCreated={handleAgreementCreated}
        />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h3 className="text font-bold">Purchase Agreements</h3>
        {canCreateAgreement && (
          <button onClick={() => setShowCreator(true)} className="button button-primary">
            Create Purchase Agreement
          </button>
        )}
      </div>

      {!canCreateAgreement && (
        <div className="alert alert-warning" style={{ marginBottom: '16px' }}>
          <p className="text-small">
            <strong>Ownership verification required:</strong> You must verify your ownership of this vehicle before creating purchase agreements.
          </p>
        </div>
      )}

      {agreements.length === 0 ? (
        <div className="text-center" style={{ padding: '32px 0', color: '#666' }}>
          <p>No purchase agreements found for this vehicle.</p>
          {canCreateAgreement && (
            <button onClick={() => setShowCreator(true)} className="button button-primary" style={{ marginTop: '16px' }}>
              Create Your First Agreement
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {agreements.map((agreement) => (
            <div key={agreement.id} className="card" style={{ cursor: 'pointer' }}
                  onClick={() => setSelectedAgreement(agreement)}>
              <div className="card-body">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <p className="text font-bold">
                      {agreement.buyer_name || 'Buyer Not Assigned'}
                    </p>
                    <p className="text-small text-muted">
                      Sales Price: ${agreement.vehicle_sales_price?.toLocaleString()} •
                      Created: {new Date(agreement.agreement_date).toLocaleDateString()}
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className={`badge ${
                      agreement.status === 'completed' ? 'badge-success' :
                      agreement.status === 'pending_signatures' ? 'badge-secondary' :
                      'badge-default'
                    }`}>
                      {agreement.status.replace('_', ' ').toUpperCase()}
                    </span>
                    <button className="button button-small">
                      View Details
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: '24px' }}>
        <p className="text-small text-muted">
          <strong>Note:</strong> All purchase agreements are legally binding documents.
          Digital signatures have the same legal validity as handwritten signatures.
          Please review all terms carefully before signing.
        </p>
      </div>
    </div>
  );
}