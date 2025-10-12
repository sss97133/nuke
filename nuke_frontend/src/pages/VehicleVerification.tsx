import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import AppLayout from '../components/layout/AppLayout';
import VerificationBadges from '../components/VerificationBadges';
import type { VerificationSystem } from '../services/verificationSystem';
import type { VerificationRecord, VehicleVerificationStatus } from '../services/verificationSystem';
import '../design-system.css';

interface VehicleData {
  id: string;
  year?: number;
  make?: string;
  model?: string;
  color?: string;
  vin?: string;
  mileage?: number;
  condition?: string;
  purchasePrice?: number;
  primaryImageUrl?: string;
  dataSource: 'ai' | 'manual' | 'hybrid';
}

const VehicleVerification: React.FC = () => {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();
  const [vehicle, setVehicle] = useState<VehicleData | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<VehicleVerificationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [verificationNotes, setVerificationNotes] = useState('');
  const [verificationMethod, setVerificationMethod] = useState<'visual_inspection' | 'document_review' | 'hands_on_inspection'>('visual_inspection');

  useEffect(() => {
    if (vehicleId) {
      loadVehicleData();
    }
  }, [vehicleId]);

  const loadVehicleData = async () => {
    try {
      // Load vehicle data
      const { data: vehicleData, error: vehicleError } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', vehicleId)
        .single();

      if (vehicleError) throw vehicleError;
      setVehicle(vehicleData);

      // Load verification records from database
      const { data: verificationData, error: verificationError } = await supabase
        .from('vehicle_verifications')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (verificationError) {
        console.error('Error loading verification data:', verificationError);
      }

      const verificationRecords: VerificationRecord[] = (verificationData || []).map(record => ({
        id: record.id,
        vehicleId: record.vehicle_id,
        verifierId: record.verifier_id,
        verifierType: record.verifier_type || 'owner',
        verificationLevel: record.verification_level || 'basic',
        fieldsVerified: record.fields_verified || [],
        verificationMethod: record.verification_method || 'visual_inspection',
        confidence: record.confidence || 0.5,
        timestamp: record.created_at,
        isActive: record.is_active,
        notes: record.notes
      }));

      const trustScore = VerificationSystem.calculateTrustScore(verificationRecords);
      const verificationLevels = VerificationSystem.updateVerificationLevels(verificationRecords);
      const badges = VerificationSystem.getVerificationBadges({
        vehicleId: vehicleId!,
        overallTrustScore: trustScore,
        verificationLevels,
        verificationCount: verificationRecords.length,
        lastVerifiedAt: verificationRecords[0]?.timestamp || '',
        verificationRecords
      });

      setVerificationStatus({
        vehicleId: vehicleId!,
        overallTrustScore: trustScore,
        verificationLevels,
        verificationCount: verificationRecords.length,
        lastVerifiedAt: verificationRecords[0]?.timestamp || '',
        verificationRecords
      });

    } catch (error) {
      console.error('Error loading vehicle data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFieldToggle = (field: string) => {
    const newSelected = new Set(selectedFields);
    if (newSelected.has(field)) {
      newSelected.delete(field);
    } else {
      newSelected.add(field);
    }
    setSelectedFields(newSelected);
  };

  const submitVerification = async () => {
    if (selectedFields.size === 0) {
      alert('Please select at least one field to verify');
      return;
    }

    setVerifying(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const newVerification: Omit<VerificationRecord, 'id'> = {
        vehicleId: vehicleId!,
        verifierId: session?.user?.id || 'anonymous',
        verifierType: 'owner', // This would be determined by user profile
        verificationLevel: 'detailed',
        fieldsVerified: Array.from(selectedFields),
        verificationMethod,
        confidence: 0.95,
        notes: verificationNotes,
        timestamp: new Date().toISOString(),
        isActive: true
      };

      // Save verification to database
      const { error: insertError } = await supabase
        .from('vehicle_verifications')
        .insert({
          vehicle_id: newVerification.vehicleId,
          verifier_id: newVerification.verifierId,
          verifier_type: newVerification.verifierType,
          verification_level: newVerification.verificationLevel,
          fields_verified: newVerification.fieldsVerified,
          verification_method: newVerification.verificationMethod,
          confidence: newVerification.confidence,
          notes: newVerification.notes,
          is_active: true
        });

      if (insertError) {
        throw insertError;
      }

      // Reload data to show updated verification status
      await loadVehicleData();
      
      // Reset form
      setSelectedFields(new Set());
      setVerificationNotes('');
      
      alert('Verification submitted successfully!');
    } catch (error) {
      console.error('Error submitting verification:', error);
      alert('Failed to submit verification');
    } finally {
      setVerifying(false);
    }
  };

  if (loading) {
    return (
      <AppLayout title="Loading Vehicle...">
        <div className="section">
          <div className="loading-spinner"></div>
        </div>
      </AppLayout>
    );
  }

  if (!vehicle) {
    return (
      <AppLayout title="Vehicle Not Found">
        <div className="section">
          <div className="card">
            <div className="card-body text-center">
              <h2 className="text font-bold mb-2">Vehicle Not Found</h2>
              <p className="text-muted mb-4">The requested vehicle could not be found.</p>
              <button 
                className="button button-primary"
                onClick={() => navigate('/vehicles')}
              >
                Back to Vehicles
              </button>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  const verifiableFields = [
    { key: 'year', label: 'Year', value: vehicle.year },
    { key: 'make', label: 'Make', value: vehicle.make },
    { key: 'model', label: 'Model', value: vehicle.model },
    { key: 'color', label: 'Color', value: vehicle.color },
    { key: 'vin', label: 'VIN', value: vehicle.vin },
    { key: 'mileage', label: 'Mileage', value: vehicle.mileage },
    { key: 'condition', label: 'Condition', value: vehicle.condition },
    { key: 'purchasePrice', label: 'Purchase Price', value: vehicle.purchasePrice }
  ].filter(field => field.value !== null && field.value !== undefined);

  const incentives = verificationStatus ? 
    VerificationSystem.getVerificationIncentives(vehicle, verificationStatus.verificationRecords) : 
    null;

  return (
    <AppLayout
      title="Vehicle Verification"
      showBackButton={true}
      breadcrumbs={[
        { label: "Vehicles", path: "/vehicles" },
        { label: `${vehicle.year} ${vehicle.make} ${vehicle.model}`, path: `/vehicles/${vehicle.id}` },
        { label: "Verification" }
      ]}
    >
      <div className="fade-in">
        {/* Vehicle Summary */}
        <section className="section">
          <div className="card">
            <div className="card-header">
              <div className="flex items-center justify-between">
                <h2 className="text font-bold">
                  {vehicle.year} {vehicle.make} {vehicle.model}
                </h2>
                <div className="badge badge-secondary">
                  {vehicle.dataSource.toUpperCase()} Import
                </div>
              </div>
            </div>
            <div className="card-body">
              <div className="flex gap-6">
                {vehicle.primaryImageUrl && (
                  <img 
                    src={vehicle.primaryImageUrl}
                    alt="Vehicle"
                    className="w-32 h-32 object-cover rounded"
                  />
                )}
                <div className="flex-1">
                  {verificationStatus && (
                    <VerificationBadges
                      badges={VerificationSystem.getVerificationBadges(verificationStatus)}
                      trustScore={verificationStatus.overallTrustScore}
                      verificationCount={verificationStatus.verificationCount}
                      showDetails={true}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Verification Incentives */}
        {incentives && (
          <section className="section">
            <div className="card">
              <div className="card-header">Why Verify This Data?</div>
              <div className="card-body">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <h4 className="text-small font-bold mb-2">Value Increase</h4>
                    <div className="text-large font-bold text-green-600">
                      +{incentives.valueIncrease.toFixed(1)}%
                    </div>
                    <p className="text-small text-muted">Potential value increase</p>
                  </div>
                  <div>
                    <h4 className="text-small font-bold mb-2">Market Advantages</h4>
                    <ul className="text-small space-y-1">
                      {incentives.marketAdvantages.slice(0, 2).map((advantage, index) => (
                        <li key={index} className="flex items-center gap-1">
                          <span className="text-green-500">✓</span>
                          {advantage}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="text-small font-bold mb-2">Trust Benefits</h4>
                    <ul className="text-small space-y-1">
                      {incentives.trustBenefits.slice(0, 2).map((benefit, index) => (
                        <li key={index} className="flex items-center gap-1">
                          <span className="text-blue-500">✓</span>
                          {benefit}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Verification Form */}
        <section className="section">
          <div className="card">
            <div className="card-header">Verify Vehicle Data</div>
            <div className="card-body">
              <div className="space-y-6">
                {/* Verification Method */}
                <div>
                  <label className="label">Verification Method</label>
                  <select 
                    className="input"
                    value={verificationMethod}
                    onChange={(e) => setVerificationMethod(e.target.value as any)}
                  >
                    <option value="visual_inspection">Visual Inspection</option>
                    <option value="document_review">Document Review</option>
                    <option value="hands_on_inspection">Hands-on Inspection</option>
                  </select>
                </div>

                {/* Fields to Verify */}
                <div>
                  <label className="label">Select Fields to Verify</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {verifiableFields.map((field) => (
                      <label key={field.key} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedFields.has(field.key)}
                          onChange={() => handleFieldToggle(field.key)}
                        />
                        <div>
                          <div className="text-small font-medium">{field.label}</div>
                          <div className="text-small text-muted">{field.value}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Verification Notes */}
                <div>
                  <label className="label">Verification Notes (Optional)</label>
                  <textarea
                    className="input"
                    rows={3}
                    placeholder="Add any notes about your verification process or findings..."
                    value={verificationNotes}
                    onChange={(e) => setVerificationNotes(e.target.value)}
                  />
                </div>

                {/* Submit Button */}
                <div className="flex gap-3">
                  <button
                    className="button button-primary"
                    onClick={submitVerification}
                    disabled={verifying || selectedFields.size === 0}
                  >
                    {verifying ? 'Submitting...' : `Verify ${selectedFields.size} Field${selectedFields.size !== 1 ? 's' : ''}`}
                  </button>
                  <button
                    className="button button-secondary"
                    onClick={() => navigate(`/vehicles/${vehicle.id}`)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Verification History */}
        {verificationStatus && verificationStatus.verificationRecords.length > 0 && (
          <section className="section">
            <div className="card">
              <div className="card-header">Verification History</div>
              <div className="card-body">
                <div className="space-y-3">
                  {verificationStatus.verificationRecords.map((record) => (
                    <div key={record.id} className="border rounded p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="badge badge-primary">{record.verifierType}</span>
                          <span className="badge badge-secondary">{record.verificationLevel}</span>
                          <span className="text-small text-muted">
                            {Math.round(record.confidence * 100)}% confidence
                          </span>
                        </div>
                        <div className="text-small text-muted">
                          {new Date(record.timestamp).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="text-small">
                        <strong>Verified:</strong> {record.fieldsVerified.join(', ')}
                      </div>
                      {record.notes && (
                        <div className="text-small text-muted mt-1">
                          <strong>Notes:</strong> {record.notes}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </AppLayout>
  );
};

export default VehicleVerification;
