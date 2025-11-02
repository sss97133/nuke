/**
 * Work Order Request Form
 * Allows customers to submit work requests to a shop
 */

import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { supabase } from '../../lib/supabase';

interface WorkOrderRequestFormProps {
  organizationId: string;
  organizationName: string;
  laborRate?: number | null;
  onSubmitted: () => void;
  onClose: () => void;
}

export const WorkOrderRequestForm: React.FC<WorkOrderRequestFormProps> = ({
  organizationId,
  organizationName,
  laborRate,
  onSubmitted,
  onClose
}) => {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userVehicles, setUserVehicles] = useState<any[]>([]);
  
  // Form state
  const [vehicleId, setVehicleId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [urgency, setUrgency] = useState('normal');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setCurrentUserId(user.id);
    setCustomerEmail(user.email || '');

    // Load user's profile for name/phone
    const { data: profile } = await supabase
      .from('profiles')
      .select('username, phone')
      .eq('id', user.id)
      .single();

    if (profile) {
      setCustomerName(profile.username || '');
      setCustomerPhone(profile.phone || '');
    }

    // Load user's vehicles
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('id, year, make, model, vin')
      .eq('user_id', user.id)
      .order('year', { ascending: false });

    if (vehicles) {
      setUserVehicles(vehicles);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadingImages(true);
    const newImages: string[] = [];

    try {
      for (const file of Array.from(files)) {
        // Upload to Supabase storage
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${fileExt}`;
        const storagePath = `work-orders/${organizationId}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('vehicle-data')
          .upload(storagePath, file);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('vehicle-data')
          .getPublicUrl(storagePath);

        newImages.push(publicUrl);
      }

      setUploadedImages([...uploadedImages, ...newImages]);
    } catch (error: any) {
      console.error('Error uploading images:', error);
      alert(`Failed to upload images: ${error.message}`);
    } finally {
      setUploadingImages(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title || !description) {
      alert('Please provide a title and description');
      return;
    }

    setSubmitting(true);

    try {
      const { error } = await supabase
        .from('work_orders')
        .insert({
          organization_id: organizationId,
          customer_id: currentUserId,
          vehicle_id: vehicleId || null,
          title,
          description,
          urgency,
          customer_name: customerName,
          customer_phone: customerPhone,
          customer_email: customerEmail,
          request_source: 'web',
          status: 'pending',
          images: uploadedImages
        });

      if (error) throw error;

      alert(`Work order submitted to ${organizationName}! They will contact you with a quote.`);
      onSubmitted();
      onClose();
    } catch (error: any) {
      console.error('Error submitting work order:', error);
      alert(`Failed to submit work order: ${error.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return ReactDOM.createPortal(
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          maxWidth: '600px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-header">
          <h3 style={{ fontSize: '11pt', fontWeight: 700, margin: 0 }}>
            Request Work from {organizationName}
          </h3>
          {laborRate && (
            <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Shop rate: ${laborRate}/hr
            </div>
          )}
        </div>
        <div className="card-body">
          <form onSubmit={handleSubmit}>
            
            {/* Vehicle Selection */}
            {userVehicles.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <label className="form-label" style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '4px', display: 'block' }}>
                  Vehicle (Optional)
                </label>
                <select
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                  className="form-select"
                  style={{ width: '100%', fontSize: '9pt' }}
                >
                  <option value="">Select a vehicle...</option>
                  {userVehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.year} {v.make} {v.model} {v.vin ? `(${v.vin.slice(-6)})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Work Title */}
            <div style={{ marginBottom: '16px' }}>
              <label className="form-label" style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '4px', display: 'block' }}>
                Work Needed *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Upholstery repair, engine tune-up, brake replacement"
                className="form-input"
                style={{ width: '100%', fontSize: '9pt' }}
                required
              />
            </div>

            {/* Description */}
            <div style={{ marginBottom: '16px' }}>
              <label className="form-label" style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '4px', display: 'block' }}>
                Description *
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Please describe the work you need done in detail..."
                className="form-input"
                style={{ width: '100%', fontSize: '9pt', minHeight: '100px', resize: 'vertical' }}
                required
              />
            </div>

            {/* Urgency */}
            <div style={{ marginBottom: '16px' }}>
              <label className="form-label" style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '4px', display: 'block' }}>
                Urgency
              </label>
              <select
                value={urgency}
                onChange={(e) => setUrgency(e.target.value)}
                className="form-select"
                style={{ width: '100%', fontSize: '9pt' }}
              >
                <option value="low">Low - Flexible timeline</option>
                <option value="normal">Normal - Standard priority</option>
                <option value="high">High - Need it soon</option>
                <option value="emergency">Emergency - ASAP</option>
              </select>
            </div>

            <hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid var(--border-light)' }} />

            {/* Photo Upload */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '8px' }}>
                Add Photos (Recommended)
              </div>
              <div style={{ 
                padding: '12px', 
                border: '2px dashed var(--border)', 
                borderRadius: '4px',
                background: '#f8f9fa',
                textAlign: 'center'
              }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  capture="environment"
                  onChange={handleImageUpload}
                  style={{ display: 'none' }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingImages}
                  className="button button-secondary"
                  style={{ fontSize: '9pt', marginBottom: '8px' }}
                >
                  {uploadingImages ? 'Uploading...' : '📸 Take Photos / Upload'}
                </button>
                <div style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
                  Photos help the shop provide an accurate quote
                </div>
                
                {/* Uploaded images preview */}
                {uploadedImages.length > 0 && (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px', justifyContent: 'center' }}>
                    {uploadedImages.map((url, idx) => (
                      <div
                        key={idx}
                        style={{
                          position: 'relative',
                          width: '80px',
                          height: '80px',
                          backgroundImage: `url(${url})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                          borderRadius: '4px',
                          border: '2px solid var(--border)'
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setUploadedImages(uploadedImages.filter((_, i) => i !== idx))}
                          style={{
                            position: 'absolute',
                            top: '-8px',
                            right: '-8px',
                            width: '20px',
                            height: '20px',
                            borderRadius: '50%',
                            background: '#dc3545',
                            color: 'white',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '12px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid var(--border-light)' }} />

            {/* Contact Info */}
            <div style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '8px' }}>
              Contact Information
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label className="form-label" style={{ fontSize: '9pt', marginBottom: '4px', display: 'block' }}>
                Your Name
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="form-input"
                style={{ width: '100%', fontSize: '9pt' }}
              />
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label className="form-label" style={{ fontSize: '9pt', marginBottom: '4px', display: 'block' }}>
                Phone Number
              </label>
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="(555) 123-4567"
                className="form-input"
                style={{ width: '100%', fontSize: '9pt' }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label className="form-label" style={{ fontSize: '9pt', marginBottom: '4px', display: 'block' }}>
                Email
              </label>
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="form-input"
                style={{ width: '100%', fontSize: '9pt' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button
                type="button"
                onClick={onClose}
                className="button button-secondary"
                style={{ fontSize: '9pt' }}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button button-primary"
                style={{ fontSize: '9pt' }}
                disabled={submitting}
              >
                {submitting ? 'Submitting...' : 'Submit Work Request'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default WorkOrderRequestForm;

