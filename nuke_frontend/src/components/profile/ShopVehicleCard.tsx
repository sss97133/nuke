import React from 'react';
import { Link } from 'react-router-dom';
import VehicleThumbnail from '../VehicleThumbnail';
import '../../design-system.css';

interface VehicleData {
  id: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  vin?: string | null;
  created_at?: string;
  sale_price?: number | null;
  current_value?: number | null;
  is_for_sale?: boolean | null;
  uploaded_by?: string;
  profiles?: any;
}

interface ShopVehicleCardProps {
  vehicle: VehicleData;
  viewMode: 'gallery' | 'compact' | 'technical';
  denseMode?: boolean;
}

const ShopVehicleCard: React.FC<ShopVehicleCardProps> = ({ vehicle, viewMode, denseMode = false }) => {
  const getUserDisplay = () => {
    if (vehicle.profiles?.full_name) return vehicle.profiles.full_name;
    if (vehicle.profiles?.username) return vehicle.profiles.username;
    return 'Unknown';
  };

  const formatPrice = (price?: number | null) => {
    if (!price) return null;
    return `$${price.toLocaleString()}`;
  };

  const smallChipStyle: React.CSSProperties = {
    background: 'var(--bg)',
    border: '1px solid #c0c0c0',
    padding: '1px 4px',
    borderRadius: '2px',
    fontSize: '8pt',
    color: '#374151'
  };

  // Gallery View - Minimal card with large image
  if (viewMode === 'gallery') {
    return (
      <Link
        to={`/vehicle/${vehicle.id}`}
        className="content-card"
        style={{
          background: 'var(--surface)',
          border: '1px solid #c0c0c0',
          borderRadius: '2px',
          overflow: 'hidden',
          textDecoration: 'none',
          display: 'block',
          cursor: 'pointer'
        }}
      >
        {/* Image */}
        <div style={{ position: 'relative', width: '100%', height: denseMode ? '160px' : '200px', overflow: 'hidden' }}>
          <VehicleThumbnail vehicleId={vehicle.id} />
        </div>
        
        {/* Content */}
        <div style={{ padding: '8px' }}>
          <h3 className="heading-3" style={{ margin: '0 0 4px 0', fontSize: '10pt', lineHeight: 1.3 }}>
            {vehicle.year} {vehicle.make} {vehicle.model}
          </h3>
          {(vehicle.sale_price || vehicle.asking_price || vehicle.current_value) && (
            <div className="text" style={{ fontSize: '8pt', color: '#3b82f6', fontWeight: 'bold' }}>
              {formatPrice(vehicle.sale_price || vehicle.asking_price || vehicle.current_value)}
            </div>
          )}
        </div>
      </Link>
    );
  }

  // Compact View - Medium card with more info
  if (viewMode === 'compact') {
    return (
      <Link
        to={`/vehicle/${vehicle.id}`}
        className="content-card"
        style={{
          background: 'var(--surface)',
          border: '1px solid #c0c0c0',
          borderRadius: '2px',
          overflow: 'hidden',
          textDecoration: 'none',
          display: 'block',
          cursor: 'pointer'
        }}
      >
        {/* Image */}
        <div style={{ position: 'relative', width: '100%', height: denseMode ? '100px' : '120px', overflow: 'hidden' }}>
          <VehicleThumbnail vehicleId={vehicle.id} />
        </div>
        
        {/* Content */}
        <div style={{ padding: '8px' }}>
          {/* Title */}
          <h3 className="heading-3" style={{ margin: '0 0 4px 0', fontSize: '10pt', lineHeight: 1.3 }}>
            {vehicle.year} {vehicle.make} {vehicle.model}
          </h3>
          
          {/* Owner */}
          <div className="text text-muted" style={{ fontSize: '8pt', marginBottom: '4px' }}>
            {getUserDisplay()}
          </div>
          
          {/* Price and Status */}
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
            {(vehicle.sale_price || vehicle.asking_price || vehicle.current_value) && (
              <span className="badge" style={{ ...smallChipStyle, color: '#3b82f6', fontWeight: 'bold' }}>
                {formatPrice(vehicle.sale_price || vehicle.asking_price || vehicle.current_value)}
              </span>
            )}
            {vehicle.is_for_sale && (
              <span className="badge" style={{ ...smallChipStyle, background: '#dcfce7', color: '#166534' }}>
                For Sale
              </span>
            )}
          </div>
        </div>
      </Link>
    );
  }

  // Technical View - List with all details
  return (
    <Link
      to={`/vehicle/${vehicle.id}`}
      className="content-card"
      style={{
        background: 'var(--surface)',
        border: '1px solid #c0c0c0',
        borderRadius: '2px',
        overflow: 'hidden',
        textDecoration: 'none',
        display: 'block',
        cursor: 'pointer'
      }}
    >
      <div style={{ display: 'flex', gap: '12px', padding: '8px' }}>
        {/* Small Thumbnail */}
        <div style={{ width: denseMode ? '80px' : '120px', height: denseMode ? '60px' : '90px', flexShrink: 0, overflow: 'hidden' }}>
          <VehicleThumbnail vehicleId={vehicle.id} />
        </div>
        
        {/* Details */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title */}
          <h3 className="heading-3" style={{ margin: '0 0 4px 0', fontSize: '10pt', lineHeight: 1.3 }}>
            {vehicle.year} {vehicle.make} {vehicle.model}
          </h3>
          
          {/* VIN */}
          <div className="text text-muted" style={{ fontSize: '8pt', marginBottom: '2px' }}>
            VIN: {vehicle.vin || 'Not provided'}
          </div>
          
          {/* Owner */}
          <div className="text text-muted" style={{ fontSize: '8pt', marginBottom: '2px' }}>
            Owner: {getUserDisplay()}
          </div>
          
          {/* Date */}
          <div className="text text-muted" style={{ fontSize: '8pt', marginBottom: '4px' }}>
            Added: {vehicle.created_at ? new Date(vehicle.created_at).toLocaleDateString() : 'Unknown'}
          </div>
          
          {/* Badges */}
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
            {(vehicle.sale_price || vehicle.asking_price || vehicle.current_value) && (
              <span className="badge" style={{ ...smallChipStyle, color: '#3b82f6', fontWeight: 'bold' }}>
                {formatPrice(vehicle.sale_price || vehicle.asking_price || vehicle.current_value)}
              </span>
            )}
            {vehicle.is_for_sale && (
              <span className="badge" style={{ ...smallChipStyle, background: '#dcfce7', color: '#166534' }}>
                For Sale
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
};

export default ShopVehicleCard;

