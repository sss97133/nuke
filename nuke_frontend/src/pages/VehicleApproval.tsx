import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import AppLayout from '../components/layout/AppLayout';
import '../design-system.css';

interface ExtractedVehicleData {
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
  extractionSource: 'ai_vision' | 'ai_document' | 'dropbox_import';
  extractionConfidence: number;
  extractedAt: string;
  rawExtraction?: any;
  needsApproval: boolean;
}

interface FieldApproval {
  field: string;
  originalValue: any;
  approvedValue: any;
  isApproved: boolean;
  confidence: number;
}

const VehicleApproval: React.FC = () => {
  const { extractionId } = useParams<{ extractionId: string }>();
  const navigate = useNavigate();
  const [extractedData, setExtractedData] = useState<ExtractedVehicleData | null>(null);
  const [fieldApprovals, setFieldApprovals] = useState<FieldApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (extractionId) {
      loadExtractionData();
    }
  }, [extractionId]);

  const loadExtractionData = async () => {
    try {
      // Load extracted vehicle data pending approval
      const { data: extractionData, error: extractionError } = await supabase
        .from('vehicle_extractions')
        .select('*')
        .eq('id', extractionId)
        .eq('needs_approval', true)
        .single();

      if (extractionError) throw extractionError;
      setExtractedData(extractionData);

      // Initialize field approvals
      const vehicleFields = [
        { field: 'year', value: extractionData.year },
        { field: 'make', value: extractionData.make },
        { field: 'model', value: extractionData.model },
        { field: 'color', value: extractionData.color },
        { field: 'vin', value: extractionData.vin },
        { field: 'mileage', value: extractionData.mileage },
        { field: 'condition', value: extractionData.condition },
        { field: 'purchasePrice', value: extractionData.purchasePrice }
      ].filter(item => item.value !== null && item.value !== undefined);

      const approvals: FieldApproval[] = vehicleFields.map(item => ({
        field: item.field,
        originalValue: item.value,
        approvedValue: item.value,
        isApproved: false,
        confidence: extractionData.extractionConfidence || 0.5
      }));

      setFieldApprovals(approvals);
    } catch (error) {
      console.error('Error loading extraction data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFieldApproval = (field: string, approved: boolean) => {
    setFieldApprovals(prev => 
      prev.map(approval => 
        approval.field === field 
          ? { ...approval, isApproved: approved }
          : approval
      )
    );
  };

  const handleFieldValueChange = (field: string, newValue: any) => {
    setFieldApprovals(prev => 
      prev.map(approval => 
        approval.field === field 
          ? { ...approval, approvedValue: newValue, isApproved: true }
          : approval
      )
    );
  };

  const submitApproval = async () => {
    if (!extractedData) return;

    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      // Create approved vehicle record
      const approvedFields = fieldApprovals.filter(f => f.isApproved);
      const vehicleData: any = {
        // Note: Do NOT include user_id/owner_id - it's set automatically by the database via auth context
        data_source: 'ai_approved',
        extraction_id: extractionId
      };

      // Map approved values to vehicle fields
      approvedFields.forEach(approval => {
        vehicleData[approval.field] = approval.approvedValue;
      });

      const { data: vehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .insert(vehicleData)
        .select()
        .single();

      if (vehicleError) throw vehicleError;

      // Create approval record
      const { error: approvalError } = await supabase
        .from('vehicle_approvals')
        .insert({
          extraction_id: extractionId,
          vehicle_id: vehicle.id,
          // Note: approver_id is set automatically by RLS
          approved_fields: approvedFields.map(f => f.field),
          approval_notes: notes,
          confidence_score: approvedFields.reduce((sum, f) => sum + f.confidence, 0) / approvedFields.length
        });

      if (approvalError) throw approvalError;

      // Mark extraction as processed
      const { error: updateError } = await supabase
        .from('vehicle_extractions')
        .update({ 
          needs_approval: false, 
          processed_at: new Date().toISOString(),
          vehicle_id: vehicle.id
        })
        .eq('id', extractionId);

      if (updateError) throw updateError;

      // Navigate to the new vehicle
      navigate(`/vehicles/${vehicle.id}`);
    } catch (error) {
      console.error('Error submitting approval:', error);
      alert('Failed to submit approval');
    } finally {
      setSubmitting(false);
    }
  };

  const rejectExtraction = async () => {
    if (!extractedData) return;

    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      // Create rejection record
      const { error: rejectionError } = await supabase
        .from('vehicle_approvals')
        .insert({
          extraction_id: extractionId,
          approver_id: session?.user?.id,
          approved_fields: [],
          approval_notes: notes || 'Extraction rejected',
          confidence_score: 0,
          is_rejected: true
        });

      if (rejectionError) throw rejectionError;

      // Mark extraction as processed
      const { error: updateError } = await supabase
        .from('vehicle_extractions')
        .update({ 
          needs_approval: false, 
          processed_at: new Date().toISOString(),
          is_rejected: true
        })
        .eq('id', extractionId);

      if (updateError) throw updateError;

      navigate('/dashboard');
    } catch (error) {
      console.error('Error rejecting extraction:', error);
      alert('Failed to reject extraction');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <AppLayout title="Loading Extraction...">
        <div className="container">
          <div className="loading">Loading vehicle extraction data...</div>
        </div>
      </AppLayout>
    );
  }

  if (!extractedData) {
    return (
      <AppLayout title="Extraction Not Found">
        <div className="container">
          <div className="card">
            <div className="card-body">
              <p className="text">Vehicle extraction not found or already processed.</p>
              <button 
                className="button button-primary"
                onClick={() => navigate('/dashboard')}
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  const approvedCount = fieldApprovals.filter(f => f.isApproved).length;

  return (
    <AppLayout title="Review AI Extraction">
      <div className="container">
        <div className="page-header">
          <h1 className="heading-1">Review AI Vehicle Extraction</h1>
          <p className="text-muted">
            Review and approve the AI-extracted vehicle data below. You can modify values before approval.
          </p>
        </div>

        <div className="grid grid-2">
          {/* Vehicle Image */}
          <div className="card">
            <div className="card-header">Vehicle Image</div>
            <div className="card-body">
              {extractedData.primaryImageUrl ? (
                <img 
                  src={extractedData.primaryImageUrl} 
                  alt="Vehicle" 
                  className="w-full rounded"
                  style={{ maxHeight: '300px', objectFit: 'cover' }}
                />
              ) : (
                <div className="text-center text-muted p-8">
                  No image available
                </div>
              )}
            </div>
          </div>

          {/* Extraction Info */}
          <div className="card">
            <div className="card-header">Extraction Details</div>
            <div className="card-body space-y-3">
              <div>
                <span className="text-small text-muted">Source:</span>
                <span className="text ml-2 capitalize">{extractedData.extractionSource.replace('_', ' ')}</span>
              </div>
              <div>
                <span className="text-small text-muted">Confidence:</span>
                <span className="text ml-2">{Math.round(extractedData.extractionConfidence * 100)}%</span>
              </div>
              <div>
                <span className="text-small text-muted">Extracted:</span>
                <span className="text ml-2">{new Date(extractedData.extractedAt).toLocaleDateString()}</span>
              </div>
              <div>
                <span className="text-small text-muted">Status:</span>
                <span className="text ml-2 text-orange-600">Pending Approval</span>
              </div>
            </div>
          </div>
        </div>

        {/* Field Approvals */}
        <div className="card">
          <div className="card-header">
            <div className="flex items-center justify-between">
              <span>Vehicle Data Fields</span>
              <span className="text-small text-muted">
                {approvedCount} of {fieldApprovals.length} approved
              </span>
            </div>
          </div>
          <div className="card-body">
            <div className="space-y-4">
              {fieldApprovals.map((approval) => (
                <div key={approval.field} className="border rounded p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={approval.isApproved}
                          onChange={(e) => handleFieldApproval(approval.field, e.target.checked)}
                        />
                        <span className="text font-medium capitalize">
                          {approval.field.replace(/([A-Z])/g, ' $1').toLowerCase()}
                        </span>
                      </label>
                      <span className="text-small text-muted">
                        {Math.round(approval.confidence * 100)}% confidence
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="text-small text-muted">Original Value:</label>
                      <div className="text">{approval.originalValue}</div>
                    </div>
                    <div className="flex-1">
                      <label className="text-small text-muted">Approved Value:</label>
                      <input
                        type="text"
                        className="input"
                        value={approval.approvedValue || ''}
                        onChange={(e) => handleFieldValueChange(approval.field, e.target.value)}
                        disabled={!approval.isApproved}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="card">
          <div className="card-header">Approval Notes</div>
          <div className="card-body">
            <textarea
              className="textarea"
              placeholder="Add any notes about this approval..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <button 
            className="button button-secondary"
            onClick={rejectExtraction}
            disabled={submitting}
          >
            Reject Extraction
          </button>
          <button 
            className="button button-primary"
            onClick={submitApproval}
            disabled={submitting || approvedCount === 0}
          >
            {submitting ? 'Processing...' : `Approve ${approvedCount} Fields`}
          </button>
        </div>
      </div>
    </AppLayout>
  );
};

export default VehicleApproval;
