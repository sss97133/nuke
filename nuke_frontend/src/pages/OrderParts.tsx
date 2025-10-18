import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const OrderParts: React.FC = () => {
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [partsNotes, setPartsNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setVehicleId(params.get('vehicle_id'));
    setEventId(params.get('event'));
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user) {
      window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }
    try {
      setSubmitting(true);
      await supabase.from('user_interactions').insert({
        user_id: session.user.id,
        interaction_type: 'intent_order_parts',
        target_type: 'event',
        target_id: eventId,
        context: { vehicle_id: vehicleId, notes: partsNotes }
      });
      setSubmitted(true);
    } catch (err) {
      console.error('order parts intent failed', err);
      alert('Could not submit your request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container">
      <div className="main">
        <div className="card">
          <div className="card-body" style={{ padding: '12px' }}>
            <h2 className="heading-2" style={{ margin: 0 }}>Order Parts</h2>
            <p className="text text-muted" style={{ marginTop: '6px' }}>
              You're requesting parts related to this vehicle/event. We'll route your request.
            </p>

            {submitted ? (
              <div className="text" style={{ marginTop: '12px' }}>
                Thanks! Your request has been received.
                <div style={{ marginTop: '8px' }}>
                  <a className="button button-secondary" href={`/vehicle/${vehicleId || ''}`}>Back to vehicle</a>
                  <a className="button button-primary" style={{ marginLeft: 8 }} href="/shops">Find suppliers</a>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} style={{ marginTop: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 520 }}>
                  <label className="text">
                    What parts are you looking for?
                    <textarea value={partsNotes} onChange={(e) => setPartsNotes(e.target.value)} rows={4} style={{ width: '100%', border: '1px solid #c0c0c0', padding: 6 }} />
                  </label>
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                  <button type="submit" className="button button-primary" disabled={submitting}>
                    {submitting ? 'Submitting...' : 'Send Request'}
                  </button>
                  <a className="button button-secondary" href="/shops">Browse suppliers</a>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrderParts;
