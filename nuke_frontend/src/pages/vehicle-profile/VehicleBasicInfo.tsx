import React from 'react';
import { useNavigate } from 'react-router-dom';
import VehicleDataQualityRating from '../../components/VehicleDataQualityRating';
import URLDataDrop from '../../components/vehicle/URLDataDrop';
import InlineVINEditor from '../../components/vehicle/InlineVINEditor';
import { BATListingManager } from '../../components/vehicle/BATListingManager';
import { FaviconIcon } from '../../components/common/FaviconIcon';
import type { VehicleBasicInfoProps} from './types';
import { useToast } from '../../components/ui/Toast';

const CRAIGSLIST_FIELD_KEYS = new Set([
  'fuel_type',
  'drivetrain',
  'body_style',
  'engine_size',
  'displacement',
  'horsepower',
  'torque'
]);

const VehicleBasicInfo: React.FC<VehicleBasicInfoProps> = ({
  vehicle,
  session,
  permissions,
  onDataPointClick = () => {}, // Default no-op function
  onEditClick
}) => {
  // Ensure onDataPointClick is always a function - defensive wrapper
  const safeOnDataPointClick = React.useMemo(() => {
    if (onDataPointClick && typeof onDataPointClick === 'function') {
      return onDataPointClick;
    }
    return () => {}; // Return no-op if not provided or invalid
  }, [onDataPointClick]);

  const handleDataPointClick = React.useCallback((e: React.MouseEvent, fieldName: string, fieldValue: string, fieldLabel: string) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      safeOnDataPointClick(e, fieldName, fieldValue, fieldLabel);
    } catch (error) {
      console.error('[VehicleBasicInfo] Error in handleDataPointClick:', error, { fieldName, fieldValue, fieldLabel });
    }
  }, [safeOnDataPointClick]);
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { isVerifiedOwner, hasContributorAccess, contributorRole } = permissions;
  const canEdit = isVerifiedOwner || hasContributorAccess;
  const [collapsed, setCollapsed] = React.useState(false); // Always expanded - user preference

  const listingSourceLabel = React.useMemo(() => {
    const rawSource = (vehicle.listing_source || vehicle.discovery_source || '').toString();
    return rawSource.toLowerCase();
  }, [vehicle.listing_source, vehicle.discovery_source]);

  const listingUrl = React.useMemo(() => {
    return (vehicle.listing_url || vehicle.discovery_url || '') as string;
  }, [vehicle.listing_url, vehicle.discovery_url]);

  const listingHost = React.useMemo(() => {
    if (!listingUrl) return null;
    try {
      const host = new URL(listingUrl).hostname;
      return host.startsWith('www.') ? host.slice(4) : host;
    } catch {
      return null;
    }
  }, [listingUrl]);

  const listingCapturedDate = React.useMemo(() => {
    return vehicle.listing_posted_at || vehicle.listing_updated_at || vehicle.created_at || null;
  }, [vehicle.listing_posted_at, vehicle.listing_updated_at, vehicle.created_at]);

  const isCraigslistListing = React.useMemo(() => {
    return listingSourceLabel.includes('craigslist');
  }, [listingSourceLabel]);

  const handleCraigslistToast = React.useCallback((fieldLabel: string) => {
    const siteLabel = listingHost || 'Craigslist';
    let message = `${fieldLabel} verified from ${siteLabel} listing.`;

    if (listingCapturedDate) {
      const date = new Date(listingCapturedDate);
      if (!Number.isNaN(date.getTime())) {
        const formatted = date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });
        message = `${fieldLabel} verified from ${siteLabel} listing captured ${formatted}.`;
      }
    }

    showToast(message, 'info', 4200);
  }, [listingCapturedDate, listingHost, showToast]);

  const renderVehicleDetails = () => {
    const v: any = vehicle;
    const extra: Array<{ label: string; key: string; formatter?: (val: any) => string }> = [
      { label: 'Fuel Type', key: 'fuel_type' },
      { label: 'Drivetrain', key: 'drivetrain' },
      { label: 'Body Style', key: 'body_style' },
      { label: 'Doors', key: 'doors' },
      { label: 'Seats', key: 'seats' },
      { label: 'Engine Size', key: 'engine_size' },
      { label: 'Horsepower', key: 'horsepower' },
      { label: 'Torque', key: 'torque' },
      { label: 'Weight', key: 'weight_lbs', formatter: (x) => `${Number(x).toLocaleString()} lbs` },
      { label: 'Wheelbase', key: 'wheelbase_inches', formatter: (x) => `${x}"` },
      { label: 'Length', key: 'length_inches', formatter: (x) => `${x}"` },
      { label: 'Width', key: 'width_inches', formatter: (x) => `${x}"` },
      { label: 'Height', key: 'height_inches', formatter: (x) => `${x}"` },
      { label: 'MPG (City)', key: 'mpg_city' },
      { label: 'MPG (Highway)', key: 'mpg_highway' },
      { label: 'MPG (Combined)', key: 'mpg_combined' },
    ];

    return extra
      .filter(({ key }) => v && typeof v[key] !== 'undefined' && v[key] !== null && v[key] !== '')
      .map(({ label, key, formatter }) => {
        const value = formatter ? formatter(v[key]) : String(v[key]);
        const showCraigslistFlag = isCraigslistListing && CRAIGSLIST_FIELD_KEYS.has(key);

        return (
          <div key={key} className="vehicle-detail" style={{ padding: '2px 0', margin: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {label}
              {showCraigslistFlag && (
                <button
                  type="button"
                  onClick={() => handleCraigslistToast(label)}
                  aria-label={`Craigslist verified data: ${label}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: 'none',
                    background: 'transparent',
                    padding: 0,
                    cursor: 'pointer',
                    marginLeft: '2px'
                  }}
                  title="Craigslist verified"
                >
                  <FaviconIcon 
                    url={vehicle?.discovery_url || 'https://craigslist.org'} 
                    matchTextSize={true} 
                    textSize={8}
                  />
                </button>
              )}
            </span>
            <span
              className="commentable"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleDataPointClick(e, key, value, label);
              }}
              style={{ cursor: 'pointer' }}
            >
              {value}
            </span>
          </div>
        );
      });
  };

  return (
    <div style={{
      background: 'var(--bg)',
      border: '1px solid var(--border)',
      padding: '0px',
      margin: '0',
      fontFamily: 'Arial, sans-serif'
    }}>
      <div style={{
        background: 'var(--grey-200)',
        padding: '4px 6px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        cursor: 'pointer'
      }} onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Expand' : 'Collapse'}>
        <span style={{ fontSize: '8pt', fontWeight: 'bold' }}>
          {collapsed ? `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.vin ? ' • ' + String(vehicle.vin).slice(0,8) + '…' : ''}` : 'Basic Information'}
        </span>
        {canEdit && (
          <button
            onClick={(e) => { 
              e.stopPropagation(); 
              // Navigate to vehicle edit form
              navigate(`/vehicle/${vehicle.id}/edit`);
            }}
            style={{
              background: 'var(--primary)',
              color: 'var(--white)',
              border: '1px solid var(--border)',
              borderRadius: '0px',
              padding: '2px 6px',
              fontSize: '7pt',
              cursor: 'pointer'
            }}
          >
            Edit
          </button>
        )}
      </div>
      {!collapsed && (
      <>

      {/* Vehicle Details */}
      <div style={{ padding: '8px' }}>
        <div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '2px 0',
            borderBottom: '1px solid var(--border)',
            fontSize: '8pt',
            marginBottom: '2px'
          }}>
            <span>Year</span>
            <span
              style={{ cursor: 'pointer', textDecoration: 'underline' }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleDataPointClick(e, 'year', vehicle.year?.toString() || '', 'Year');
              }}
            >
              {vehicle.year}
            </span>
          </div>
          <div className="vehicle-detail" style={{ padding: '2px 0', margin: 0 }}>
            <span>Make</span>
            <span
              className="commentable"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleDataPointClick(e, 'make', vehicle.make || '', 'Make');
              }}
              style={{ cursor: 'pointer', userSelect: 'none' }}
            >
              {vehicle.make}
            </span>
          </div>
          <div className="vehicle-detail" style={{ padding: '2px 0', margin: 0 }}>
            <span>Model</span>
            <span
              className="commentable"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleDataPointClick(e, 'model', vehicle.model || '', 'Model');
              }}
              style={{ cursor: 'pointer' }}
            >
              {vehicle.model}
            </span>
          </div>
          {(vehicle as any).series && (
            <div className="vehicle-detail" style={{ padding: '2px 0', margin: 0 }}>
              <span>Series</span>
              <span
                className="commentable"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDataPointClick(e, 'series', (vehicle as any).series || '', 'Series');
                }}
                style={{ cursor: 'pointer' }}
              >
                {(vehicle as any).series}
              </span>
            </div>
          )}
          <div className="vehicle-detail" style={{ padding: '2px 0', margin: 0 }}>
            <span>VIN</span>
            <span
              className="commentable"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleDataPointClick(e, 'vin', vehicle.vin || '', 'VIN');
              }}
              style={{ cursor: 'pointer' }}
            >
              {vehicle.vin || 'Not provided'}
            </span>
          </div>
          <div className="vehicle-detail" style={{ padding: '2px 0', margin: 0 }}>
            <span>Color</span>
            <span
              className="commentable"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleDataPointClick(e, 'color', vehicle.color || '', 'Color');
              }}
              style={{ cursor: 'pointer' }}
            >
              {vehicle.color || 'Not specified'}
            </span>
          </div>
          <div className="vehicle-detail" style={{ padding: '2px 0', margin: 0 }}>
            <span>Mileage</span>
            <span
              className="commentable"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleDataPointClick(e, 'mileage', vehicle.mileage?.toString() || '', 'Mileage');
              }}
              style={{ cursor: 'pointer' }}
            >
              {vehicle.mileage ? `${vehicle.mileage.toLocaleString()} miles` : 'Not specified'}
            </span>
          </div>
          {listingUrl && (
            <div className="vehicle-detail" style={{ padding: '2px 0', margin: 0 }}>
              <span>Source</span>
              <span>
                <a 
                  href={listingUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  style={{ color: 'var(--primary)', textDecoration: 'underline' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                    {isCraigslistListing && vehicle?.discovery_url && (
                      <FaviconIcon 
                        url={vehicle.discovery_url} 
                        matchTextSize={true} 
                        textSize={8}
                      />
                    )}
                    {listingSourceLabel || listingHost || 'External Listing'}
                  </span>
                </a>
                {listingCapturedDate && (
                  <span style={{ fontSize: '7pt', color: 'var(--text-muted)', marginLeft: '4px' }}>
                    ({new Date(listingCapturedDate).toLocaleDateString()})
                  </span>
                )}
              </span>
            </div>
          )}
          {vehicle.trim && (
            <div className="vehicle-detail" style={{ padding: '2px 0', margin: 0 }}>
              <span>Trim</span>
              <span
                className="commentable"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDataPointClick(e, 'trim', vehicle.trim || '', 'Trim');
                }}
                style={{ cursor: 'pointer' }}
              >
                {vehicle.trim}
              </span>
            </div>
          )}
          {vehicle.engine && (
            <div className="vehicle-detail" style={{ padding: '2px 0', margin: 0 }}>
              <span>Engine</span>
              <span
                className="commentable"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDataPointClick(e, 'engine', vehicle.engine || '', 'Engine');
                }}
                style={{ cursor: 'pointer' }}
              >
                {vehicle.engine}
              </span>
            </div>
          )}
          {vehicle.transmission && (
            <div className="vehicle-detail" style={{ padding: '2px 0', margin: 0 }}>
              <span>Transmission</span>
              <span
                className="commentable"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDataPointClick(e, 'transmission', vehicle.transmission || '', 'Transmission');
                }}
                style={{ cursor: 'pointer' }}
              >
                {vehicle.transmission}
              </span>
            </div>
          )}
          {/* Additional details */}
          {renderVehicleDetails()}
        </div>
      </div>

      {/* Vehicle Interactions & Ownership - DISABLED (missing DB tables) */}

      </>
      )}

      {/* REMOVED: Build System (B&V) - deprecated manual tracking system
          Replaced by AI Expert Agent valuation in VisualValuationBreakdown
          Archived to _archive_document_uploaders/ */}
    </div>
  );
};

export default VehicleBasicInfo;