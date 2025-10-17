import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import VehicleThumbnail from '../VehicleThumbnail';
import DataContextModal from './DataContextModal';
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
  purchase_price?: number | null;
  msrp?: number | null;
  is_for_sale?: boolean | null;
  uploaded_by?: string;
  profiles?: any;
}

interface EnhancedVehicleCardProps {
  vehicle: VehicleData;
  viewMode: 'gallery' | 'compact' | 'technical';
  denseMode?: boolean;
  onDataClick?: (contextType: string, contextValue: any) => void;
}

const EnhancedVehicleCard: React.FC<EnhancedVehicleCardProps> = ({ 
  vehicle, 
  viewMode, 
  denseMode = false 
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalContext, setModalContext] = useState<{
    type: 'year' | 'make' | 'model' | 'estimate' | 'band' | 'confidence' | null;
    value: string | number | null;
  }>({ type: null, value: null });
  const [sortPreference, setSortPreference] = useState<'coolest' | 'nearest' | 'best_opportunity'>('coolest');

  const getUserDisplay = () => {
    if (vehicle.profiles?.full_name) return vehicle.profiles.full_name;
    if (vehicle.profiles?.username) return vehicle.profiles.username;
    return 'User';
  };

  const calculateEstimate = () => {
    return vehicle.current_value || vehicle.sale_price || vehicle.purchase_price || vehicle.msrp || 0;
  };

  const calculateChange = () => {
    const current = vehicle.current_value || vehicle.sale_price || 0;
    const original = vehicle.purchase_price || vehicle.msrp || current;
    if (original === 0) return null;
    return ((current - original) / original) * 100;
  };

  const getConfidence = () => {
    // Calculate confidence based on data availability
    let confidence = 0;
    if (vehicle.current_value) confidence += 30;
    if (vehicle.purchase_price) confidence += 30;
    if (vehicle.msrp) confidence += 20;
    if (vehicle.vin) confidence += 10;
    if (vehicle.year && vehicle.make && vehicle.model) confidence += 10;
    return confidence;
  };

  const getMarketBand = () => {
    const estimate = calculateEstimate();
    if (estimate === 0) return null;
    return {
      low: Math.round(estimate * 0.85),
      mid: Math.round(estimate),
      high: Math.round(estimate * 1.15)
    };
  };

  const handleBadgeClick = (e: React.MouseEvent, type: 'year' | 'make' | 'model' | 'estimate' | 'band' | 'confidence', value: any) => {
    e.preventDefault();
    e.stopPropagation();
    setModalContext({ type, value });
    setModalOpen(true);
  };

  const formatPrice = (price: number) => {
    if (price >= 1000) {
      return `$${(price / 1000).toFixed(0)}k`;
    }
    return `$${price.toLocaleString()}`;
  };

  const smallChipStyle: React.CSSProperties = {
    background: '#f3f4f6',
    border: '1px solid #c0c0c0',
    padding: '1px 4px',
    borderRadius: '2px',
    fontSize: '8pt',
    color: '#374151',
    cursor: 'pointer',
    transition: 'all 0.15s',
    userSelect: 'none'
  };

  const hoverStyle: React.CSSProperties = {
    background: '#e5e7eb',
    borderColor: '#9ca3af'
  };

  const estimate = calculateEstimate();
  const change = calculateChange();
  const confidence = getConfidence();
  const band = getMarketBand();

  // Gallery View
  if (viewMode === 'gallery') {
    return (
      <>
        <div
          className="content-card"
          style={{
            background: 'white',
            border: '1px solid #c0c0c0',
            borderRadius: '2px',
            overflow: 'hidden',
            display: 'block'
          }}
        >
          <Link to={`/vehicle/${vehicle.id}`} style={{ textDecoration: 'none' }}>
            <div style={{ position: 'relative', width: '100%', height: denseMode ? '160px' : '200px', overflow: 'hidden' }}>
              <VehicleThumbnail vehicleId={vehicle.id} />
            </div>
          </Link>
          
          <div style={{ padding: '8px' }}>
            <Link to={`/vehicle/${vehicle.id}`} style={{ textDecoration: 'none' }}>
              <h3 className="heading-3" style={{ margin: '0 0 4px 0', fontSize: '10pt', lineHeight: 1.3, color: '#111' }}>
                {vehicle.year} {vehicle.make} {vehicle.model}
              </h3>
            </Link>
            
            <div className="text text-muted" style={{ fontSize: '8pt', marginBottom: '4px' }}>
              {new Date(vehicle.created_at || '').toLocaleDateString()}
            </div>

            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
              {estimate > 0 && (
                <span
                  className="badge"
                  style={smallChipStyle}
                  onClick={(e) => handleBadgeClick(e, 'estimate', estimate)}
                  title="Click to see comparable valuations"
                  onMouseEnter={(e) => Object.assign(e.currentTarget.style, hoverStyle)}
                  onMouseLeave={(e) => Object.assign(e.currentTarget.style, { background: '#f3f4f6', borderColor: '#c0c0c0' })}
                >
                  EST: {formatPrice(estimate)}
                </span>
              )}
              
              {change !== null && (
                <span
                  className="badge"
                  style={{
                    ...smallChipStyle,
                    color: change >= 0 ? '#166534' : '#991b1b'
                  }}
                  onClick={(e) => handleBadgeClick(e, 'estimate', estimate)}
                  title="Value change over time"
                  onMouseEnter={(e) => Object.assign(e.currentTarget.style, hoverStyle)}
                  onMouseLeave={(e) => Object.assign(e.currentTarget.style, { background: '#f3f4f6', borderColor: '#c0c0c0' })}
                >
                  {change >= 0 ? '↑' : '↓'} {Math.abs(change).toFixed(1)}%
                </span>
              )}
              
              {confidence > 0 && (
                <span
                  className="badge"
                  style={smallChipStyle}
                  onClick={(e) => handleBadgeClick(e, 'confidence', confidence)}
                  title="Data confidence score"
                  onMouseEnter={(e) => Object.assign(e.currentTarget.style, hoverStyle)}
                  onMouseLeave={(e) => Object.assign(e.currentTarget.style, { background: '#f3f4f6', borderColor: '#c0c0c0' })}
                >
                  conf {confidence}
                </span>
              )}
            </div>
          </div>
        </div>

        <DataContextModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          contextType={modalContext.type}
          contextValue={modalContext.value}
          currentVehicleId={vehicle.id}
          sortPreference={sortPreference}
        />
      </>
    );
  }

  // Compact View
  if (viewMode === 'compact') {
    return (
      <>
        <div
          className="content-card"
          style={{
            background: 'white',
            border: '1px solid #c0c0c0',
            borderRadius: '2px',
            overflow: 'hidden',
            display: 'block'
          }}
        >
          <Link to={`/vehicle/${vehicle.id}`} style={{ textDecoration: 'none' }}>
            <div style={{ position: 'relative', width: '100%', height: denseMode ? '100px' : '120px', overflow: 'hidden' }}>
              <VehicleThumbnail vehicleId={vehicle.id} />
            </div>
          </Link>
          
          <div style={{ padding: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
              <div style={{ flex: 1 }}>
                <div className="text text-bold" style={{ fontSize: '8pt' }}>{getUserDisplay()}</div>
                <div className="text text-muted" style={{ fontSize: '8pt' }}>
                  {new Date(vehicle.created_at || '').toLocaleDateString()}
                </div>
              </div>
            </div>

            <Link to={`/vehicle/${vehicle.id}`} style={{ textDecoration: 'none' }}>
              <h3 className="heading-3" style={{ margin: '0 0 4px 0', fontSize: '10pt', lineHeight: 1.3, color: '#111' }}>
                {vehicle.year} {vehicle.make} {vehicle.model}
              </h3>
            </Link>

            <div style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span
                  className="badge"
                  style={smallChipStyle}
                  onClick={(e) => handleBadgeClick(e, 'year', vehicle.year)}
                  title={`See other ${vehicle.year} vehicles`}
                  onMouseEnter={(e) => Object.assign(e.currentTarget.style, hoverStyle)}
                  onMouseLeave={(e) => Object.assign(e.currentTarget.style, { background: '#f3f4f6', borderColor: '#c0c0c0' })}
                >
                  {vehicle.year}
                </span>
                
                <span
                  className="badge"
                  style={smallChipStyle}
                  onClick={(e) => handleBadgeClick(e, 'make', vehicle.make)}
                  title={`See other ${vehicle.make} vehicles`}
                  onMouseEnter={(e) => Object.assign(e.currentTarget.style, hoverStyle)}
                  onMouseLeave={(e) => Object.assign(e.currentTarget.style, { background: '#f3f4f6', borderColor: '#c0c0c0' })}
                >
                  {vehicle.make}
                </span>
                
                <span
                  className="badge"
                  style={smallChipStyle}
                  onClick={(e) => handleBadgeClick(e, 'model', vehicle.model)}
                  title={`See other ${vehicle.model} vehicles`}
                  onMouseEnter={(e) => Object.assign(e.currentTarget.style, hoverStyle)}
                  onMouseLeave={(e) => Object.assign(e.currentTarget.style, { background: '#f3f4f6', borderColor: '#c0c0c0' })}
                >
                  {vehicle.model}
                </span>

                {estimate > 0 && (
                  <span
                    className="badge"
                    style={smallChipStyle}
                    onClick={(e) => handleBadgeClick(e, 'estimate', estimate)}
                    title="Click to see comparable valuations"
                    onMouseEnter={(e) => Object.assign(e.currentTarget.style, hoverStyle)}
                    onMouseLeave={(e) => Object.assign(e.currentTarget.style, { background: '#f3f4f6', borderColor: '#c0c0c0' })}
                  >
                    EST: {formatPrice(estimate)}
                  </span>
                )}
                
                {change !== null && (
                  <span
                    className="badge"
                    style={{
                      ...smallChipStyle,
                      color: change >= 0 ? '#166534' : '#991b1b'
                    }}
                    onClick={(e) => handleBadgeClick(e, 'estimate', estimate)}
                    title="Value change over time"
                    onMouseEnter={(e) => Object.assign(e.currentTarget.style, hoverStyle)}
                    onMouseLeave={(e) => Object.assign(e.currentTarget.style, { background: '#f3f4f6', borderColor: '#c0c0c0' })}
                  >
                    {change >= 0 ? '↑' : '↓'} {Math.abs(change).toFixed(1)}%
                  </span>
                )}

                {band && (
                  <span
                    className="badge"
                    style={smallChipStyle}
                    onClick={(e) => handleBadgeClick(e, 'band', band)}
                    title="Market value band: 85%–100%–115% of estimate"
                    onMouseEnter={(e) => Object.assign(e.currentTarget.style, hoverStyle)}
                    onMouseLeave={(e) => Object.assign(e.currentTarget.style, { background: '#f3f4f6', borderColor: '#c0c0c0' })}
                  >
                    Band: {formatPrice(band.low)}–{formatPrice(band.mid)}–{formatPrice(band.high)}
                  </span>
                )}
                
                {confidence > 0 && (
                  <span
                    className="badge"
                    style={smallChipStyle}
                    onClick={(e) => handleBadgeClick(e, 'confidence', confidence)}
                    title="Data confidence score"
                    onMouseEnter={(e) => Object.assign(e.currentTarget.style, hoverStyle)}
                    onMouseLeave={(e) => Object.assign(e.currentTarget.style, { background: '#f3f4f6', borderColor: '#c0c0c0' })}
                  >
                    conf {confidence}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <DataContextModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          contextType={modalContext.type}
          contextValue={modalContext.value}
          currentVehicleId={vehicle.id}
          sortPreference={sortPreference}
        />
      </>
    );
  }

  // Technical View
  return (
    <>
      <div
        className="content-card"
        style={{
          background: 'white',
          border: '1px solid #c0c0c0',
          borderRadius: '2px',
          overflow: 'hidden',
          display: 'block'
        }}
      >
        <div style={{ display: 'flex', gap: '12px', padding: '8px' }}>
          <Link to={`/vehicle/${vehicle.id}`} style={{ textDecoration: 'none', flexShrink: 0 }}>
            <div style={{ width: denseMode ? '80px' : '120px', height: denseMode ? '60px' : '90px', overflow: 'hidden' }}>
              <VehicleThumbnail vehicleId={vehicle.id} />
            </div>
          </Link>
          
          <div style={{ flex: 1, minWidth: 0 }}>
            <Link to={`/vehicle/${vehicle.id}`} style={{ textDecoration: 'none' }}>
              <h3 className="heading-3" style={{ margin: '0 0 4px 0', fontSize: '10pt', lineHeight: 1.3, color: '#111' }}>
                {vehicle.year} {vehicle.make} {vehicle.model}
              </h3>
            </Link>
            
            <div className="text text-muted" style={{ fontSize: '8pt', marginBottom: '2px' }}>
              VIN: {vehicle.vin || 'Not provided'}
            </div>
            
            <div className="text text-muted" style={{ fontSize: '8pt', marginBottom: '2px' }}>
              Owner: {getUserDisplay()}
            </div>
            
            <div className="text text-muted" style={{ fontSize: '8pt', marginBottom: '4px' }}>
              Added: {new Date(vehicle.created_at || '').toLocaleDateString()}
            </div>
            
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span
                className="badge"
                style={smallChipStyle}
                onClick={(e) => handleBadgeClick(e, 'year', vehicle.year)}
                title={`See other ${vehicle.year} vehicles`}
                onMouseEnter={(e) => Object.assign(e.currentTarget.style, hoverStyle)}
                onMouseLeave={(e) => Object.assign(e.currentTarget.style, { background: '#f3f4f6', borderColor: '#c0c0c0' })}
              >
                {vehicle.year}
              </span>
              
              <span
                className="badge"
                style={smallChipStyle}
                onClick={(e) => handleBadgeClick(e, 'make', vehicle.make)}
                title={`See other ${vehicle.make} vehicles`}
                onMouseEnter={(e) => Object.assign(e.currentTarget.style, hoverStyle)}
                onMouseLeave={(e) => Object.assign(e.currentTarget.style, { background: '#f3f4f6', borderColor: '#c0c0c0' })}
              >
                {vehicle.make}
              </span>
              
              <span
                className="badge"
                style={smallChipStyle}
                onClick={(e) => handleBadgeClick(e, 'model', vehicle.model)}
                title={`See other ${vehicle.model} vehicles`}
                onMouseEnter={(e) => Object.assign(e.currentTarget.style, hoverStyle)}
                onMouseLeave={(e) => Object.assign(e.currentTarget.style, { background: '#f3f4f6', borderColor: '#c0c0c0' })}
              >
                {vehicle.model}
              </span>

              {estimate > 0 && (
                <span
                  className="badge"
                  style={smallChipStyle}
                  onClick={(e) => handleBadgeClick(e, 'estimate', estimate)}
                  title="Click to see comparable valuations"
                  onMouseEnter={(e) => Object.assign(e.currentTarget.style, hoverStyle)}
                  onMouseLeave={(e) => Object.assign(e.currentTarget.style, { background: '#f3f4f6', borderColor: '#c0c0c0' })}
                >
                  EST: {formatPrice(estimate)}
                </span>
              )}
              
              {change !== null && (
                <span
                  className="badge"
                  style={{
                    ...smallChipStyle,
                    color: change >= 0 ? '#166534' : '#991b1b'
                  }}
                  onClick={(e) => handleBadgeClick(e, 'estimate', estimate)}
                  title="Value change over time"
                  onMouseEnter={(e) => Object.assign(e.currentTarget.style, hoverStyle)}
                  onMouseLeave={(e) => Object.assign(e.currentTarget.style, { background: '#f3f4f6', borderColor: '#c0c0c0' })}
                >
                  {change >= 0 ? '↑' : '↓'} {Math.abs(change).toFixed(1)}%
                </span>
              )}

              {band && (
                <span
                  className="badge"
                  style={smallChipStyle}
                  onClick={(e) => handleBadgeClick(e, 'band', band)}
                  title="Market value band"
                  onMouseEnter={(e) => Object.assign(e.currentTarget.style, hoverStyle)}
                  onMouseLeave={(e) => Object.assign(e.currentTarget.style, { background: '#f3f4f6', borderColor: '#c0c0c0' })}
                >
                  Band: {formatPrice(band.low)}–{formatPrice(band.mid)}–{formatPrice(band.high)}
                </span>
              )}
              
              {confidence > 0 && (
                <span
                  className="badge"
                  style={smallChipStyle}
                  onClick={(e) => handleBadgeClick(e, 'confidence', confidence)}
                  title="Data confidence score"
                  onMouseEnter={(e) => Object.assign(e.currentTarget.style, hoverStyle)}
                  onMouseLeave={(e) => Object.assign(e.currentTarget.style, { background: '#f3f4f6', borderColor: '#c0c0c0' })}
                >
                  conf {confidence}
                </span>
              )}

              {vehicle.is_for_sale && (
                <span className="badge" style={{ 
                  ...smallChipStyle, 
                  background: '#dcfce7', 
                  color: '#166534',
                  cursor: 'default'
                }}>
                  For Sale
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <DataContextModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        contextType={modalContext.type}
        contextValue={modalContext.value}
        currentVehicleId={vehicle.id}
        sortPreference={sortPreference}
      />
    </>
  );
};

export default EnhancedVehicleCard;

