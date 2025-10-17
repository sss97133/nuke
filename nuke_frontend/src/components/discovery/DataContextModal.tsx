import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Link } from 'react-router-dom';
import VehicleThumbnail from '../VehicleThumbnail';
import '../../design-system.css';

interface DataContextModalProps {
  isOpen: boolean;
  onClose: () => void;
  contextType: 'year' | 'make' | 'model' | 'estimate' | 'band' | 'confidence' | null;
  contextValue: string | number | null;
  currentVehicleId?: string;
  sortPreference?: 'coolest' | 'nearest' | 'best_opportunity' | 'highest_value' | 'most_documented';
}

interface ComparableVehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  current_value: number | null;
  purchase_price: number | null;
  msrp: number | null;
  created_at: string;
  uploaded_by: string;
  sale_price: number | null;
  vin: string | null;
}

const DataContextModal: React.FC<DataContextModalProps> = ({
  isOpen,
  onClose,
  contextType,
  contextValue,
  currentVehicleId,
  sortPreference = 'coolest'
}) => {
  const [vehicles, setVehicles] = useState<ComparableVehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState(sortPreference);

  useEffect(() => {
    if (isOpen && contextType && contextValue !== null) {
      loadContextData();
    }
  }, [isOpen, contextType, contextValue, sortBy]);

  const loadContextData = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('vehicles')
        .select('id, year, make, model, current_value, purchase_price, msrp, created_at, uploaded_by, sale_price, vin');

      // Filter based on context type
      switch (contextType) {
        case 'year':
          query = query.eq('year', contextValue);
          break;
        case 'make':
          query = query.ilike('make', `${contextValue}`);
          break;
        case 'model':
          query = query.ilike('model', `${contextValue}`);
          break;
      }

      // Exclude current vehicle if provided
      if (currentVehicleId) {
        query = query.neq('id', currentVehicleId);
      }

      // Apply sorting based on preference
      switch (sortBy) {
        case 'highest_value':
          query = query.order('current_value', { ascending: false });
          break;
        case 'best_opportunity':
          // Calculate ROI potential (current_value / purchase_price)
          query = query.not('purchase_price', 'is', null).not('current_value', 'is', null);
          break;
        case 'most_documented':
          query = query.order('created_at', { ascending: true });
          break;
        case 'nearest':
          // Could be expanded with geolocation
          query = query.order('created_at', { ascending: false });
          break;
        default: // coolest
          query = query.order('current_value', { ascending: false });
      }

      query = query.limit(20);

      const { data, error } = await query;

      if (error) throw error;

      let processedData = data || [];

      // Post-process for best_opportunity
      if (sortBy === 'best_opportunity' && processedData.length > 0) {
        processedData = processedData
          .map(v => ({
            ...v,
            roi: v.current_value && v.purchase_price ? (v.current_value - v.purchase_price) / v.purchase_price : 0
          }))
          .sort((a, b) => (b as any).roi - (a as any).roi);
      }

      setVehicles(processedData);
    } catch (error) {
      console.error('Error loading context data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getTitle = () => {
    if (!contextType || contextValue === null) return 'Similar Vehicles';
    
    switch (contextType) {
      case 'year':
        return `${contextValue} Vehicles`;
      case 'make':
        return `${contextValue} Vehicles`;
      case 'model':
        return `${contextValue} Vehicles`;
      case 'estimate':
        return 'Estimated Value Analysis';
      case 'band':
        return 'Market Band Analysis';
      case 'confidence':
        return 'Confidence Score Details';
      default:
        return 'Data Context';
    }
  };

  const getSortLabel = (sort: string) => {
    switch (sort) {
      case 'coolest': return 'Highest Value';
      case 'nearest': return 'Most Recent';
      case 'best_opportunity': return 'Best ROI';
      case 'highest_value': return 'Highest Price';
      case 'most_documented': return 'Best Documented';
      default: return sort;
    }
  };

  const calculateEstimate = (vehicle: ComparableVehicle) => {
    return vehicle.current_value || vehicle.sale_price || vehicle.purchase_price || vehicle.msrp || 0;
  };

  const calculateChange = (vehicle: ComparableVehicle) => {
    const current = vehicle.current_value || vehicle.sale_price || 0;
    const original = vehicle.purchase_price || vehicle.msrp || current;
    if (original === 0) return null;
    return ((current - original) / original) * 100;
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '16px'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '2px',
          border: '1px solid #c0c0c0',
          maxWidth: '900px',
          width: '100%',
          maxHeight: '80vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ 
          padding: '12px 16px', 
          borderBottom: '1px solid #c0c0c0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div>
            <h2 className="heading-2" style={{ margin: 0, fontSize: '11pt' }}>
              {getTitle()}
            </h2>
            <div className="text-muted" style={{ fontSize: '8pt', marginTop: '2px' }}>
              {contextType && contextType !== 'estimate' && contextType !== 'band' && contextType !== 'confidence' && (
                `Comparable vehicles based on ${contextType}`
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="button button-small"
            style={{ padding: '4px 8px', fontSize: '8pt' }}
          >
            Close
          </button>
        </div>

        {/* Sort Controls */}
        {contextType && ['year', 'make', 'model'].includes(contextType) && (
          <div style={{ 
            padding: '8px 16px', 
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            gap: '4px',
            flexWrap: 'wrap'
          }}>
            <span className="text" style={{ fontSize: '8pt', marginRight: '4px' }}>Sort by:</span>
            {['coolest', 'nearest', 'best_opportunity', 'highest_value', 'most_documented'].map(sort => (
              <button
                key={sort}
                onClick={() => setSortBy(sort as any)}
                className="badge"
                style={{
                  background: sortBy === sort ? '#2563eb' : '#f3f4f6',
                  color: sortBy === sort ? 'white' : '#374151',
                  border: '1px solid #c0c0c0',
                  padding: '2px 6px',
                  borderRadius: '2px',
                  fontSize: '8pt',
                  cursor: 'pointer'
                }}
              >
                {getSortLabel(sort)}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div style={{ 
          flex: 1, 
          overflow: 'auto', 
          padding: '16px'
        }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '32px' }}>
              <div className="loading-spinner" style={{ margin: '0 auto' }}></div>
              <div className="text-muted" style={{ marginTop: '8px', fontSize: '8pt' }}>
                Loading comparable vehicles...
              </div>
            </div>
          ) : vehicles.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px' }}>
              <div className="text-muted" style={{ fontSize: '8pt' }}>
                No comparable vehicles found
              </div>
            </div>
          ) : (
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', 
              gap: '8px' 
            }}>
              {vehicles.map(vehicle => {
                const estimate = calculateEstimate(vehicle);
                const change = calculateChange(vehicle);
                
                return (
                  <Link
                    key={vehicle.id}
                    to={`/vehicle/${vehicle.id}`}
                    onClick={onClose}
                    style={{
                      textDecoration: 'none',
                      border: '1px solid #c0c0c0',
                      borderRadius: '2px',
                      overflow: 'hidden',
                      background: 'white',
                      cursor: 'pointer',
                      display: 'block'
                    }}
                  >
                    <div style={{ height: '120px', position: 'relative', overflow: 'hidden' }}>
                      <VehicleThumbnail vehicleId={vehicle.id} />
                    </div>
                    <div style={{ padding: '6px' }}>
                      <div className="text text-bold" style={{ fontSize: '8pt', marginBottom: '2px' }}>
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </div>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                        {estimate > 0 && (
                          <span className="badge" style={{
                            background: '#f3f4f6',
                            border: '1px solid #c0c0c0',
                            padding: '1px 4px',
                            borderRadius: '2px',
                            fontSize: '7pt',
                            color: '#374151'
                          }}>
                            ${estimate.toLocaleString()}
                          </span>
                        )}
                        {change !== null && (
                          <span className="badge" style={{
                            background: '#f3f4f6',
                            border: '1px solid #c0c0c0',
                            padding: '1px 4px',
                            borderRadius: '2px',
                            fontSize: '7pt',
                            color: change >= 0 ? '#166534' : '#991b1b'
                          }}>
                            {change >= 0 ? '↑' : '↓'} {Math.abs(change).toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DataContextModal;

