/**
 * Contractor Work Input Component
 * Allows contractors to log their work contributions with privacy controls
 * Extracts data from work order images/receipts to build professional portfolio
 */

import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface ContractorWorkInputProps {
  organizationId: string;
  organizationName: string;
  imageId?: string; // Optional: link to work order image
  imageUrl?: string;
  onSaved?: () => void;
  onClose?: () => void;
}

export default function ContractorWorkInput({
  organizationId,
  organizationName,
  imageId,
  imageUrl,
  onSaved,
  onClose
}: ContractorWorkInputProps) {
  const [workDescription, setWorkDescription] = useState('');
  const [workCategory, setWorkCategory] = useState('mechanical');
  const [workDate, setWorkDate] = useState(new Date().toISOString().split('T')[0]);
  const [laborHours, setLaborHours] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [materialsCost, setMaterialsCost] = useState('');
  const [vehicleName, setVehicleName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [showFinancials, setShowFinancials] = useState(false);
  const [showOnProfile, setShowOnProfile] = useState(true);
  const [loading, setLoading] = useState(false);
  
  // Auto-extract data from image if provided
  React.useEffect(() => {
    if (imageId) {
      attemptOCRExtraction();
    }
  }, [imageId]);
  
  const attemptOCRExtraction = async () => {
    if (!imageId) return;
    
    try {
      // Call the database function to extract work order data
      const { data, error } = await supabase.rpc('extract_work_order_data', {
        image_id: imageId
      });
      
      if (error) throw error;
      
      // TODO: Populate form fields from extracted data when OCR is implemented
      console.log('OCR extraction result:', data);
    } catch (error) {
      console.error('OCR extraction failed:', error);
    }
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        alert('Please log in to record work');
        return;
      }
      
      const hours = parseFloat(laborHours) || 0;
      const rate = parseFloat(hourlyRate) || 0;
      const materials = parseFloat(materialsCost) || 0;
      const laborValue = hours * rate;
      const totalValue = laborValue + materials;
      
      const { error } = await supabase
        .from('contractor_work_contributions')
        .insert({
          contractor_user_id: user.id,
          organization_id: organizationId,
          work_description: workDescription,
          work_category: workCategory,
          work_date: workDate,
          labor_hours: hours,
          hourly_rate: rate,
          total_labor_value: laborValue,
          materials_cost: materials,
          total_value: totalValue,
          source_image_id: imageId,
          vehicle_name: vehicleName || null,
          is_public: isPublic,
          show_financial_details: showFinancials,
          show_on_contractor_profile: showOnProfile
        });
      
      if (error) throw error;
      
      alert('Work contribution logged successfully');
      onSaved?.();
      onClose?.();
    } catch (error: any) {
      console.error('Error logging work:', error);
      alert(`Failed to log work: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.8)',
      zIndex: 99999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px'
    }}
    onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--white)',
          maxWidth: '600px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          borderRadius: '4px',
          border: '2px solid var(--border)'
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px',
          borderBottom: '2px solid var(--border)',
          background: 'var(--surface)'
        }}>
          <h3 style={{ fontSize: '11pt', fontWeight: 700, margin: 0 }}>
            Log Contractor Work
          </h3>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
            {organizationName}
          </div>
        </div>
        
        {/* Work Order Image Preview */}
        {imageUrl && (
          <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
              Extracting from work order:
            </div>
            <img
              src={imageUrl}
              alt="Work order"
              style={{
                width: '100%',
                maxHeight: '200px',
                objectFit: 'contain',
                border: '1px solid var(--border)',
                borderRadius: '2px'
              }}
            />
            <div style={{
              fontSize: '7pt',
              color: 'var(--warning)',
              marginTop: '8px',
              padding: '8px',
              background: '#fff3cd',
              borderRadius: '2px',
              border: '1px solid #ffeaa7'
            }}>
              This image is marked as PRIVATE. It will only be visible to you and the shop owner. Your contribution credit will be tracked.
            </div>
          </div>
        )}
        
        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '16px' }}>
          {/* Work Description */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '8pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
              Work Performed
            </label>
            <textarea
              value={workDescription}
              onChange={(e) => setWorkDescription(e.target.value)}
              required
              placeholder="Brief description of work performed..."
              className="form-input"
              style={{ fontSize: '9pt', minHeight: '80px', width: '100%', fontFamily: 'Arial' }}
            />
          </div>
          
          {/* Category & Date */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={{ fontSize: '8pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                Category
              </label>
              <select
                value={workCategory}
                onChange={(e) => setWorkCategory(e.target.value)}
                className="form-select"
                style={{ fontSize: '9pt', width: '100%' }}
              >
                <option value="mechanical">Mechanical</option>
                <option value="electrical">Electrical</option>
                <option value="bodywork">Bodywork</option>
                <option value="paint">Paint</option>
                <option value="upholstery">Upholstery</option>
                <option value="fabrication">Fabrication</option>
                <option value="restoration">Restoration</option>
                <option value="labor">General Labor</option>
                <option value="other">Other</option>
              </select>
            </div>
            
            <div>
              <label style={{ fontSize: '8pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                Date
              </label>
              <input
                type="date"
                value={workDate}
                onChange={(e) => setWorkDate(e.target.value)}
                required
                className="form-input"
                style={{ fontSize: '9pt', width: '100%' }}
              />
            </div>
          </div>
          
          {/* Labor Hours & Rate */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={{ fontSize: '8pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                Hours
              </label>
              <input
                type="number"
                step="0.25"
                value={laborHours}
                onChange={(e) => setLaborHours(e.target.value)}
                placeholder="0.0"
                className="form-input"
                style={{ fontSize: '9pt', width: '100%' }}
              />
            </div>
            
            <div>
              <label style={{ fontSize: '8pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                Rate (/hr)
              </label>
              <input
                type="number"
                step="1"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                placeholder="$0"
                className="form-input"
                style={{ fontSize: '9pt', width: '100%' }}
              />
            </div>
            
            <div>
              <label style={{ fontSize: '8pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                Materials
              </label>
              <input
                type="number"
                step="0.01"
                value={materialsCost}
                onChange={(e) => setMaterialsCost(e.target.value)}
                placeholder="$0.00"
                className="form-input"
                style={{ fontSize: '9pt', width: '100%' }}
              />
            </div>
          </div>
          
          {/* Calculated Total */}
          {(laborHours || hourlyRate || materialsCost) && (
            <div style={{
              padding: '12px',
              background: 'var(--accent-dim)',
              borderRadius: '4px',
              marginBottom: '12px',
              border: '2px solid var(--accent)'
            }}>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
                Total Contribution Value
              </div>
              <div style={{ fontSize: '14pt', fontWeight: 700, color: 'var(--accent)' }}>
                ${((parseFloat(laborHours) || 0) * (parseFloat(hourlyRate) || 0) + (parseFloat(materialsCost) || 0)).toFixed(2)}
              </div>
              <div style={{ fontSize: '7pt', color: 'var(--text-secondary)', marginTop: '4px' }}>
                {laborHours && hourlyRate && `${laborHours}h × $${hourlyRate}/hr = $${((parseFloat(laborHours) || 0) * (parseFloat(hourlyRate) || 0)).toFixed(2)}`}
                {laborHours && hourlyRate && materialsCost && ' + '}
                {materialsCost && `$${materialsCost} materials`}
              </div>
            </div>
          )}
          
          {/* Optional: Vehicle Name */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '8pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
              Vehicle (Optional)
            </label>
            <input
              type="text"
              value={vehicleName}
              onChange={(e) => setVehicleName(e.target.value)}
              placeholder="e.g., 1977 K5 Blazer, Customer's truck, etc."
              className="form-input"
              style={{ fontSize: '9pt', width: '100%' }}
            />
          </div>
          
          {/* Privacy Controls */}
          <div style={{
            padding: '12px',
            background: '#f8f9fa',
            borderRadius: '4px',
            marginBottom: '16px',
            border: '1px solid var(--border)'
          }}>
            <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '12px' }}>
              Privacy & Profile Settings
            </div>
            
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '10px', fontSize: '8pt', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showOnProfile}
                onChange={(e) => setShowOnProfile(e.target.checked)}
                style={{ marginTop: '2px' }}
              />
              <div>
                <div style={{ fontWeight: 600 }}>Show on my contractor profile</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '7pt' }}>
                  Builds your professional portfolio. Hours and work type visible, but not exact pay.
                </div>
              </div>
            </label>
            
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '10px', fontSize: '8pt', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
              />
              <div>
                <div style={{ fontWeight: 600 }}>Make this work visible to public</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '7pt' }}>
                  Show this contribution on the shop's public profile (still respects financial privacy).
                </div>
              </div>
            </label>
            
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '8pt', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showFinancials}
                onChange={(e) => setShowFinancials(e.target.checked)}
                disabled={!isPublic}
              />
              <div>
                <div style={{ fontWeight: 600 }}>Show financial details publicly</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '7pt' }}>
                  If public, also show exact hourly rate and total value. Otherwise only hours are shown.
                </div>
              </div>
            </label>
          </div>
          
          {/* Actions */}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              className="button button-secondary"
              style={{ fontSize: '8pt' }}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button button-primary"
              style={{ fontSize: '9pt' }}
              disabled={loading}
            >
              {loading ? 'Saving...' : 'Log Work Contribution'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

