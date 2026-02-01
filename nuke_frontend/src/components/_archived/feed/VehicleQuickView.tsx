import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { computePrimaryPrice, computeDelta, formatCurrency } from '../../services/priceSignalService';
import BlueGlowIcon from '../ui/BlueGlowIcon';
import '../../design-system.css';

interface VehicleQuickViewProps {
  vehicleId: string;
  isOpen: boolean;
  onClose: () => void;
}

interface VehicleData {
  id: string;
  year: number;
  make: string;
  model: string;
  color?: string;
  description?: string;
  vin?: string;
  msrp?: number;
  current_value?: number;
  purchase_price?: number;
  asking_price?: number;
  sale_price?: number;
  is_for_sale?: boolean;
  vehicle_images?: { image_url: string }[];
}

const VehicleQuickView = ({ vehicleId, isOpen, onClose }: VehicleQuickViewProps) => {
  const [vehicle, setVehicle] = useState<VehicleData | null>(null);
  const [priceSignal, setPriceSignal] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  useEffect(() => {
    if (isOpen && vehicleId) {
      loadVehicleData();
    }
  }, [isOpen, vehicleId]);

  const loadVehicleData = async () => {
    try {
      setLoading(true);

      // Fetch vehicle data
      const { data: vehicleData, error: vehicleError } = await supabase
        .from('vehicles')
        .select(`
          id,
          year,
          make,
          model,
          color,
          description,
          vin,
          msrp,
          current_value,
          purchase_price,
          asking_price,
          sale_price,
          is_for_sale,
          vehicle_images(image_url)
        `)
        .eq('id', vehicleId)
        .single();

      if (vehicleError) throw vehicleError;
      setVehicle(vehicleData as any);

      // Fetch price signal
      try {
        const { data: cached } = await supabase
          .from('vehicle_price_signal_view')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .single();

        if (cached) {
          setPriceSignal(cached);
        } else {
          const { data: fresh } = await supabase.rpc('vehicle_price_signal', { 
            vehicle_ids: [vehicleId] 
          });
          if (fresh && fresh[0]) {
            setPriceSignal(fresh[0]);
          }
        }
      } catch (e) {
        console.debug('Price signal fetch skipped:', e);
      }

    } catch (error) {
      console.error('Error loading vehicle data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleViewFullProfile = () => {
    window.location.href = `/vehicle/${vehicleId}`;
  };

  if (!isOpen) return null;

  const images = (vehicle?.vehicle_images as any) || [];
  const currentImage = images[currentImageIndex]?.image_url;

  const priceMeta = vehicle ? {
    msrp: vehicle.msrp,
    current_value: vehicle.current_value,
    purchase_price: vehicle.purchase_price,
    asking_price: vehicle.asking_price,
    sale_price: vehicle.sale_price,
    is_for_sale: vehicle.is_for_sale,
  } : null;

  const pi = priceSignal && priceSignal.primary_label && typeof priceSignal.primary_value === 'number'
    ? { label: priceSignal.primary_label, amount: priceSignal.primary_value }
    : priceMeta ? computePrimaryPrice(priceMeta as any) : { label: null, amount: null };

  const delta = priceSignal && typeof priceSignal.delta_pct === 'number' && typeof priceSignal.delta_amount === 'number'
    ? { amount: priceSignal.delta_amount, percent: priceSignal.delta_pct, isPositive: priceSignal.delta_amount >= 0 }
    : priceMeta ? computeDelta(priceMeta as any) : null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.8)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--surface)',
          borderRadius: '4px',
          maxWidth: '900px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          border: '2px solid #000'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center' }}>
            <div className="text text-muted">Loading vehicle...</div>
          </div>
        ) : vehicle ? (
          <>
            {/* Image Gallery */}
            {images.length > 0 && (
              <div style={{ position: 'relative', background: '#000', aspectRatio: '16/9' }}>
                <img
                  src={currentImage}
                  alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain'
                  }}
                />
                
                {/* Image navigation */}
                {images.length > 1 && (
                  <>
                    <button
                      onClick={() => setCurrentImageIndex(Math.max(0, currentImageIndex - 1))}
                      disabled={currentImageIndex === 0}
                      style={{
                        position: 'absolute',
                        left: '10px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'var(--surface-glass)',
                        border: '1px solid #000',
                        padding: '8px 12px',
                        cursor: 'pointer',
                        fontSize: '16px'
                      }}
                    >
                      ‹
                    </button>
                    <button
                      onClick={() => setCurrentImageIndex(Math.min(images.length - 1, currentImageIndex + 1))}
                      disabled={currentImageIndex === images.length - 1}
                      style={{
                        position: 'absolute',
                        right: '10px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'var(--surface-glass)',
                        border: '1px solid #000',
                        padding: '8px 12px',
                        cursor: 'pointer',
                        fontSize: '16px'
                      }}
                    >
                      ›
                    </button>
                    <div style={{
                      position: 'absolute',
                      bottom: '10px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: 'rgba(0, 0, 0, 0.7)',
                      color: 'white',
                      padding: '4px 8px',
                      borderRadius: '2px',
                      fontSize: '10pt'
                    }}>
                      {currentImageIndex + 1} / {images.length}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Vehicle Info */}
            <div style={{ padding: '20px' }}>
              {/* Close button */}
              <button
                onClick={onClose}
                className="button button-secondary"
                style={{
                  position: 'absolute',
                  top: '10px',
                  right: '10px',
                  padding: '4px 8px',
                  fontSize: '12pt',
                  background: 'var(--surface-glass)',
                  zIndex: 10
                }}
              >
                ×
              </button>

              {/* Title */}
              <h2 style={{ margin: '0 0 12px 0', fontSize: '18pt', fontWeight: 'bold' }}>
                {vehicle.year} {vehicle.make} {vehicle.model}
              </h2>

              {/* Price Display */}
              {pi.label && typeof pi.amount === 'number' && (
                <div style={{ marginBottom: '16px', paddingBottom: '16px', borderBottom: '1px solid #e5e7eb' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                    <span style={{ 
                      fontSize: '24pt', 
                      fontWeight: 'bold', 
                      color: '#000',
                      fontFamily: 'monospace'
                    }}>
                      {formatCurrency(pi.amount)}
                    </span>
                    <span style={{ fontSize: '10pt', color: '#666', fontWeight: 600 }}>
                      {pi.label}
                    </span>
                    {delta && (
                      <span style={{ 
                        fontSize: '10pt',
                        fontWeight: 600,
                        color: delta.isPositive ? '#16a34a' : '#dc2626'
                      }}>
                        {delta.isPositive ? '↑' : '↓'} {Math.abs(delta.percent).toFixed(1)}%
                      </span>
                    )}
                  </div>
                  
                  {/* Price signal metadata */}
                  {priceSignal && (
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                      {Array.isArray(priceSignal.sources) && priceSignal.sources.length > 0 && (
                        <span style={{ 
                          background: 'var(--bg)', 
                          padding: '2px 6px', 
                          fontSize: '8pt',
                          border: '1px solid #d1d5db',
                          borderRadius: '2px'
                        }}>
                          {priceSignal.sources.length} data {priceSignal.sources.length === 1 ? 'source' : 'sources'}
                        </span>
                      )}
                      {typeof priceSignal.confidence === 'number' && priceSignal.confidence > 0 && (
                        <span style={{ 
                          background: 'var(--bg)', 
                          padding: '2px 6px', 
                          fontSize: '8pt',
                          border: '1px solid #d1d5db',
                          borderRadius: '2px'
                        }}>
                          {priceSignal.confidence}% confidence
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Details Grid */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
                gap: '12px',
                marginBottom: '16px'
              }}>
                {vehicle.color && (
                  <div>
                    <div style={{ fontSize: '8pt', color: '#666', marginBottom: '2px' }}>Color</div>
                    <div style={{ fontSize: '10pt', fontWeight: 600 }}>{vehicle.color}</div>
                  </div>
                )}
                {vehicle.vin && (
                  <div>
                    <div style={{ fontSize: '8pt', color: '#666', marginBottom: '2px' }}>VIN</div>
                    <div style={{ fontSize: '10pt', fontWeight: 600, fontFamily: 'monospace' }}>{vehicle.vin}</div>
                  </div>
                )}
              </div>

              {/* Description */}
              {vehicle.description && (
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '8pt', color: '#666', marginBottom: '4px', fontWeight: 600 }}>Description</div>
                  <div style={{ fontSize: '10pt', lineHeight: 1.5, color: '#333' }}>
                    {vehicle.description}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: '12px', paddingTop: '16px', borderTop: '1px solid #e5e7eb' }}>
                <button
                  onClick={handleViewFullProfile}
                  className="button button-primary"
                  style={{ flex: 1, padding: '8px 16px' }}
                >
                  View Full Profile
                </button>
                <button
                  onClick={onClose}
                  className="button button-secondary"
                  style={{ padding: '8px 16px' }}
                >
                  Close
                </button>
              </div>
            </div>
          </>
        ) : (
          <div style={{ padding: '40px', textAlign: 'center' }}>
            <div className="text text-muted">Vehicle not found</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VehicleQuickView;

