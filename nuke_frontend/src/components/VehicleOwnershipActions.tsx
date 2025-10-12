import React, { useState, useEffect } from 'react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import PurchaseAgreementManager from './PurchaseAgreementManager';

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
  ownership_verified: boolean;
  ownership_verified_at?: string;
  ownership_verification_id?: string;
}

interface OwnershipVerification {
  id: string;
  status: 'pending' | 'documents_uploaded' | 'ai_processing' | 'human_review' | 'approved' | 'rejected' | 'expired';
  submitted_at: string;
  approved_at?: string;
  ai_confidence_score?: number;
}

interface VehicleOwnershipActionsProps {
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
  currentUserId: string;
}

export default function VehicleOwnershipActions({
  vehicle,
  userProfile,
  currentUserId
}: VehicleOwnershipActionsProps) {
  const [ownershipVerification, setOwnershipVerification] = useState<OwnershipVerification | null>(null);
  const [showPurchaseManager, setShowPurchaseManager] = useState(false);
  const [loading, setLoading] = useState(true);

  const isOwner = vehicle.user_id === currentUserId;
  const isOwnershipVerified = vehicle.ownership_verified;

  useEffect(() => {
    if (isOwner) {
      loadOwnershipVerificationStatus();
    } else {
      setLoading(false);
    }
  }, [vehicle.id, isOwner]);

  const loadOwnershipVerificationStatus = async () => {
    if (!vehicle.ownership_verification_id) {
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`/api/ownership-verifications/${vehicle.ownership_verification_id}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });

      if (response.ok) {
        const verification = await response.json();
        setOwnershipVerification(verification);
      }
    } catch (error) {
      console.error('Error loading ownership verification:', error);
    } finally {
      setLoading(false);
    }
  };

  const startOwnershipVerification = async () => {
    try {
      const response = await fetch('/api/ownership-verifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          vehicle_id: vehicle.id
        })
      });

      if (response.ok) {
        const newVerification = await response.json();
        setOwnershipVerification(newVerification);

        // Redirect to verification flow
        window.location.href = `/vehicles/${vehicle.id}/verify-ownership`;
      }
    } catch (error) {
      console.error('Error starting ownership verification:', error);
    }
  };

  const getVerificationStatusBadge = () => {
    if (!ownershipVerification) return null;

    const statusConfig = {
      pending: { variant: 'outline' as const, text: 'Pending', color: 'text-gray-600' },
      documents_uploaded: { variant: 'secondary' as const, text: 'Documents Uploaded', color: 'text-blue-600' },
      ai_processing: { variant: 'secondary' as const, text: 'AI Processing', color: 'text-purple-600' },
      human_review: { variant: 'secondary' as const, text: 'Under Review', color: 'text-amber-600' },
      approved: { variant: 'default' as const, text: 'Approved', color: 'text-green-600' },
      rejected: { variant: 'destructive' as const, text: 'Rejected', color: 'text-red-600' },
      expired: { variant: 'outline' as const, text: 'Expired', color: 'text-gray-500' }
    };

    const config = statusConfig[ownershipVerification.status];

    return (
      <Badge variant={config.variant} className={config.color}>
        {config.text}
      </Badge>
    );
  };

  const canCreatePurchaseAgreement = (): boolean => {
    return isOwner && isOwnershipVerified;
  };

  const getOwnershipMessage = (): string => {
    if (!isOwner) {
      return "You are not the owner of this vehicle.";
    }

    if (isOwnershipVerified) {
      return "Ownership verified. You can create purchase agreements for this vehicle.";
    }

    if (ownershipVerification) {
      switch (ownershipVerification.status) {
        case 'pending':
          return "Ownership verification started but documents not uploaded yet.";
        case 'documents_uploaded':
          return "Documents uploaded. Awaiting AI analysis.";
        case 'ai_processing':
          return "AI is analyzing your ownership documents.";
        case 'human_review':
          return "Your documents are under human review.";
        case 'approved':
          return "Ownership verification approved!";
        case 'rejected':
          return "Ownership verification was rejected. Please try again with different documents.";
        case 'expired':
          return "Ownership verification expired. Please restart the process.";
        default:
          return "Unknown verification status.";
      }
    }

    return "Ownership verification required to create purchase agreements.";
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div className="text-center">Loading ownership information...</div>
      </Card>
    );
  }

  if (showPurchaseManager) {
    return (
      <div>
        <div className="mb-4">
          <Button onClick={() => setShowPurchaseManager(false)} variant="outline">
            ← Back to Vehicle Overview
          </Button>
        </div>
        <PurchaseAgreementManager
          vehicle={vehicle}
          userProfile={userProfile}
          canCreateAgreement={canCreatePurchaseAgreement()}
        />
      </div>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Vehicle Ownership & Sales</h2>
        {ownershipVerification && getVerificationStatusBadge()}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Ownership Status */}
        <div>
          <h3 className="text-lg font-semibold mb-3">Ownership Status</h3>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant={isOwnershipVerified ? 'default' : 'outline'}>
                {isOwnershipVerified ? 'Verified Owner' : 'Unverified'}
              </Badge>
              {isOwnershipVerified && vehicle.ownership_verified_at && (
                <span className="text-sm text-gray-600">
                  Verified {new Date(vehicle.ownership_verified_at).toLocaleDateString()}
                </span>
              )}
            </div>

            <p className="text-sm text-gray-600">
              {getOwnershipMessage()}
            </p>

            {ownershipVerification && ownershipVerification.ai_confidence_score && (
              <div className="text-sm">
                <span className="text-gray-600">AI Confidence: </span>
                <span className={`font-medium ${
                  ownershipVerification.ai_confidence_score > 0.8 ? 'text-green-600' :
                  ownershipVerification.ai_confidence_score > 0.6 ? 'text-yellow-600' :
                  'text-red-600'
                }`}>
                  {Math.round(ownershipVerification.ai_confidence_score * 100)}%
                </span>
              </div>
            )}
          </div>

          {isOwner && !isOwnershipVerified && !ownershipVerification && (
            <div className="mt-4">
              <Button onClick={startOwnershipVerification} className="w-full">
                Start Ownership Verification
              </Button>
              <p className="text-xs text-gray-500 mt-2">
                Upload title, registration, or purchase documents to verify your ownership.
              </p>
            </div>
          )}

          {isOwner && ownershipVerification && !isOwnershipVerified && (
            <div className="mt-4">
              <Button
                onClick={() => window.location.href = `/vehicles/${vehicle.id}/verify-ownership`}
                variant="outline"
                className="w-full"
              >
                Continue Verification Process
              </Button>
            </div>
          )}
        </div>

        {/* Purchase Agreement Actions */}
        <div>
          <h3 className="text-lg font-semibold mb-3">Purchase Agreements</h3>

          <div className="space-y-3">
            {canCreatePurchaseAgreement() ? (
              <>
                <p className="text-sm text-gray-600">
                  Create professional purchase agreements with automatic data population,
                  digital signatures, and PDF export.
                </p>

                <div className="space-y-2">
                  <Button
                    onClick={() => setShowPurchaseManager(true)}
                    className="w-full"
                  >
                    Manage Purchase Agreements
                  </Button>

                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" size="sm">
                      Quick Sale
                    </Button>
                    <Button variant="outline" size="sm">
                      Trade-in Quote
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-600">
                  {!isOwner
                    ? "Only verified owners can create purchase agreements for this vehicle."
                    : "Complete ownership verification to unlock purchase agreement features."
                  }
                </p>

                <div className="p-3 bg-gray-50 rounded border">
                  <h4 className="font-medium text-sm mb-2">Features available after verification:</h4>
                  <ul className="text-xs text-gray-600 space-y-1">
                    <li>• Auto-filled purchase agreements</li>
                    <li>• Digital signature collection</li>
                    <li>• Professional PDF generation</li>
                    <li>• Email delivery to buyers</li>
                    <li>• Legal compliance assurance</li>
                  </ul>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="mt-6 pt-6 border-t">
        <h3 className="text-lg font-semibold mb-3">Vehicle Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-gray-600">Vehicle</div>
            <div className="font-medium">{vehicle.year} {vehicle.make} {vehicle.model}</div>
          </div>
          <div>
            <div className="text-gray-600">Estimated Value</div>
            <div className="font-medium">
              ${vehicle.current_value ? vehicle.current_value.toLocaleString() : 'TBD'}
            </div>
          </div>
          <div>
            <div className="text-gray-600">Mileage</div>
            <div className="font-medium">{vehicle.mileage?.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-gray-600">Status</div>
            <div className="font-medium text-green-600">Available</div>
          </div>
        </div>
      </div>

      <div className="mt-6 text-xs text-gray-500">
        <p>
          <strong>Legal Notice:</strong> All purchase agreements generated through this system
          comply with federal and state disclosure requirements. Digital signatures are
          legally binding and equivalent to handwritten signatures.
        </p>
      </div>
    </Card>
  );
}