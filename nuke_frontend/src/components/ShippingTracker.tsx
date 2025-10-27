import React, { useState, useEffect } from 'react';
import { getShippingStatus, getShippingEvents, ShippingEvent } from '../services/shippingService';

interface ShippingTrackerProps {
  transactionId: string;
}

export const ShippingTracker: React.FC<ShippingTrackerProps> = ({ transactionId }) => {
  const [status, setStatus] = useState<any>(null);
  const [events, setEvents] = useState<ShippingEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadShippingData();
  }, [transactionId]);

  const loadShippingData = async () => {
    try {
      const [statusData, eventsData] = await Promise.all([
        getShippingStatus(transactionId),
        getShippingEvents(transactionId)
      ]);
      
      setStatus(statusData);
      setEvents(eventsData);
    } catch (error) {
      console.error('Failed to load shipping data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div style={{ fontSize: '9pt', color: '#666' }}>Loading shipping info...</div>;
  }

  if (!status || !status.shipping_listing_id) {
    return (
      <div style={{ 
        padding: '16px', 
        background: '#f9f9f9',
        border: '1px solid #ccc',
        borderRadius: '0px',
        fontSize: '9pt'
      }}>
        <div style={{ fontWeight: 700, marginBottom: '8px' }}>🚚 Shipping Coordination</div>
        <div style={{ color: '#666' }}>
          Shipping listing will be created automatically after both parties sign documents.
        </div>
      </div>
    );
  }

  const statusSteps = [
    { key: 'listed', label: 'Listed', icon: '📋' },
    { key: 'carrier_assigned', label: 'Carrier Assigned', icon: '🚚' },
    { key: 'pickup_scheduled', label: 'Pickup Scheduled', icon: '📅' },
    { key: 'picked_up', label: 'Picked Up', icon: '✅' },
    { key: 'in_transit', label: 'In Transit', icon: '🛣️' },
    { key: 'delivered', label: 'Delivered', icon: '🎉' }
  ];

  const currentStepIndex = statusSteps.findIndex(s => s.key === status.shipping_status);

  return (
    <div style={{ 
      border: '2px solid #000',
      borderRadius: '0px',
      background: '#fff'
    }}>
      <div style={{ 
        padding: '12px 16px', 
        borderBottom: '2px solid #000',
        background: 'var(--surface-light, #f5f5f5)',
        fontWeight: 700,
        fontSize: '10pt'
      }}>
        🚚 Shipping Status
      </div>

      {/* Progress Steps */}
      <div style={{ padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '30px' }}>
          {statusSteps.map((step, index) => {
            const isComplete = index <= currentStepIndex;
            const isCurrent = index === currentStepIndex;
            
            return (
              <div key={step.key} style={{ flex: 1, textAlign: 'center', position: 'relative' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  border: `2px solid ${isComplete ? '#10b981' : '#ccc'}`,
                  background: isComplete ? '#10b981' : '#fff',
                  color: isComplete ? '#fff' : '#ccc',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 8px',
                  fontSize: '14pt',
                  fontWeight: isCurrent ? 'bold' : 'normal'
                }}>
                  {step.icon}
                </div>
                <div style={{ 
                  fontSize: '8pt', 
                  color: isComplete ? '#000' : '#999',
                  fontWeight: isCurrent ? 700 : 400
                }}>
                  {step.label}
                </div>
                
                {/* Connection line */}
                {index < statusSteps.length - 1 && (
                  <div style={{
                    position: 'absolute',
                    top: '16px',
                    left: '50%',
                    width: '100%',
                    height: '2px',
                    background: isComplete ? '#10b981' : '#ccc',
                    zIndex: -1
                  }} />
                )}
              </div>
            );
          })}
        </div>

        {/* Shipping Details */}
        <div style={{ 
          padding: '16px', 
          background: '#f9f9f9',
          borderRadius: '0px',
          marginBottom: '16px'
        }}>
          <div style={{ fontSize: '9pt', lineHeight: 1.8 }}>
            {status.shipping_listing_id && (
              <div><strong>Listing ID:</strong> {status.shipping_listing_id}</div>
            )}
            
            {status.shipping_carrier_name && (
              <>
                <div><strong>Carrier:</strong> {status.shipping_carrier_name}</div>
                {status.shipping_carrier_phone && (
                  <div><strong>Carrier Phone:</strong> {status.shipping_carrier_phone}</div>
                )}
              </>
            )}

            {status.shipping_pickup_date && (
              <div><strong>Pickup Date:</strong> {new Date(status.shipping_pickup_date).toLocaleDateString()}</div>
            )}

            {status.shipping_delivery_date && (
              <div><strong>Estimated Delivery:</strong> {new Date(status.shipping_delivery_date).toLocaleDateString()}</div>
            )}

            {status.shipping_actual_cost && (
              <div><strong>Shipping Cost:</strong> ${status.shipping_actual_cost.toLocaleString()}</div>
            )}

            {status.shipping_tracking_url && (
              <div>
                <a 
                  href={status.shipping_tracking_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  style={{ color: '#0066cc', textDecoration: 'underline' }}
                >
                  Track Shipment →
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Route Info */}
        {(status.pickup_address || status.delivery_address) && (
          <div style={{ fontSize: '9pt', marginBottom: '16px' }}>
            <div style={{ fontWeight: 700, marginBottom: '8px' }}>Route:</div>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '8pt', color: '#666' }}>PICKUP</div>
                <div>
                  {status.pickup_address?.city}, {status.pickup_address?.state} {status.pickup_address?.zip}
                </div>
              </div>
              <div style={{ fontSize: '14pt' }}>→</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '8pt', color: '#666' }}>DELIVERY</div>
                <div>
                  {status.delivery_address?.city}, {status.delivery_address?.state} {status.delivery_address?.zip}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Recent Events */}
        {events.length > 0 && (
          <div>
            <div style={{ fontWeight: 700, fontSize: '9pt', marginBottom: '8px' }}>
              Recent Updates:
            </div>
            <div style={{ fontSize: '8pt' }}>
              {events.slice(-5).reverse().map(event => (
                <div 
                  key={event.id}
                  style={{ 
                    padding: '8px', 
                    borderLeft: '3px solid #10b981',
                    marginBottom: '8px',
                    background: '#f9f9f9'
                  }}
                >
                  <div style={{ fontWeight: 700 }}>
                    {event.event_type.replace(/_/g, ' ').toUpperCase()}
                  </div>
                  <div style={{ color: '#666' }}>
                    {new Date(event.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ShippingTracker;

