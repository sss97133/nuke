/**
 * Vehicle Inquiry Modal
 * Quick inquiry form for vehicles listed by organizations
 */

import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { supabase } from '../../lib/supabase';

interface VehicleInquiryModalProps {
  vehicleId: string;
  vehicleName: string;
  organizationId: string;
  organizationName: string;
  onClose: () => void;
  onSubmitted: () => void;
}

export const VehicleInquiryModal: React.FC<VehicleInquiryModalProps> = ({
  vehicleId,
  vehicleName,
  organizationId,
  organizationName,
  onClose,
  onSubmitted
}) => {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [inquiryType, setInquiryType] = useState<'purchase' | 'viewing' | 'quote' | 'general'>('purchase');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setCurrentUserId(user.id);
    setEmail(user.email || '');

    const { data: profile } = await supabase
      .from('profiles')
      .select('username, phone')
      .eq('id', user.id)
      .single();

    if (profile) {
      setName(profile.username || '');
      setPhone(profile.phone || '');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name || !email || !message) {
      alert('Please fill in all required fields');
      return;
    }

    setSubmitting(true);

    try {
      // Create vehicle interaction request
      const { error: interactionError } = await supabase
        .from('vehicle_interaction_requests')
        .insert({
          vehicle_id: vehicleId,
          requester_id: currentUserId,
          interaction_type: inquiryType === 'purchase' ? 'purchase_inquiry' : 
                          inquiryType === 'viewing' ? 'viewing_request' : 'purchase_inquiry',
          title: `${inquiryType === 'purchase' ? 'Purchase' : inquiryType === 'viewing' ? 'Viewing' : 'Quote'} inquiry for ${vehicleName}`,
          message: `Organization: ${organizationName}\n\n${message}`,
          status: 'pending',
          metadata: {
            organization_id: organizationId,
            organization_name: organizationName,
            contact_name: name,
            contact_email: email,
            contact_phone: phone,
            inquiry_type: inquiryType
          }
        });

      if (interactionError) throw interactionError;

      // Also create a work order or inquiry record if needed
      if (currentUserId) {
        const { error: workOrderError } = await supabase
          .from('work_orders')
          .insert({
            organization_id: organizationId,
            customer_id: currentUserId,
            vehicle_id: vehicleId,
            title: `Vehicle Inquiry: ${vehicleName}`,
            description: message,
            customer_name: name,
            customer_phone: phone,
            customer_email: email,
            request_source: 'web',
            status: 'pending',
            metadata: {
              inquiry_type: inquiryType,
              vehicle_name: vehicleName
            }
          });

        // Don't fail if work order creation fails - interaction request is primary
        if (workOrderError) {
          console.warn('Work order creation failed:', workOrderError);
        }
      }

      alert(`Your inquiry has been sent to ${organizationName}! They will contact you soon.`);
      onSubmitted();
      onClose();
    } catch (error: any) {
      console.error('Error submitting inquiry:', error);
      alert(`Failed to submit inquiry: ${error.message}`);
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
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '16px'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--white)',
          borderRadius: '4px',
          maxWidth: '500px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          padding: '16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h3 style={{ margin: 0, fontSize: '12pt', fontWeight: 700 }}>Inquire About {vehicleName}</h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '20pt',
              cursor: 'pointer',
              color: 'var(--text)',
              padding: 0,
              width: '24px',
              height: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '16px' }}>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '9pt', fontWeight: 600 }}>
              Inquiry Type
            </label>
            <select
              value={inquiryType}
              onChange={(e) => setInquiryType(e.target.value as any)}
              style={{
                width: '100%',
                padding: '6px',
                fontSize: '9pt',
                border: '1px solid var(--border)',
                borderRadius: '2px'
              }}
            >
              <option value="purchase">Purchase Inquiry</option>
              <option value="viewing">Schedule Viewing</option>
              <option value="quote">Request Quote</option>
              <option value="general">General Question</option>
            </select>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '9pt', fontWeight: 600 }}>
              Your Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '6px',
                fontSize: '9pt',
                border: '1px solid var(--border)',
                borderRadius: '2px'
              }}
            />
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '9pt', fontWeight: 600 }}>
              Email *
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '6px',
                fontSize: '9pt',
                border: '1px solid var(--border)',
                borderRadius: '2px'
              }}
            />
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '9pt', fontWeight: 600 }}>
              Phone
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              style={{
                width: '100%',
                padding: '6px',
                fontSize: '9pt',
                border: '1px solid var(--border)',
                borderRadius: '2px'
              }}
            />
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '9pt', fontWeight: 600 }}>
              Message *
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              rows={4}
              placeholder={`Tell ${organizationName} about your interest in ${vehicleName}...`}
              style={{
                width: '100%',
                padding: '6px',
                fontSize: '9pt',
                border: '1px solid var(--border)',
                borderRadius: '2px',
                fontFamily: 'inherit',
                resize: 'vertical'
              }}
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
              {submitting ? 'Sending...' : 'Send Inquiry'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

export default VehicleInquiryModal;

