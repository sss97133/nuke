import React from 'react';
import { useNavigate } from 'react-router-dom';
import VehicleDataQualityRating from '../../components/VehicleDataQualityRating';
import URLDataDrop from '../../components/vehicle/URLDataDrop';
import InlineVINEditor from '../../components/vehicle/InlineVINEditor';
import BaTURLDrop from '../../components/vehicle/BaTURLDrop';
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
  onDataPointClick,
  onEditClick
}) => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { isVerifiedOwner, hasContributorAccess, contributorRole } = permissions;
  const [collapsed, setCollapsed] = React.useState(false);

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
          <div key={key} className="vehicle-detail">
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
                    width: '16px',
                    height: '16px',
                    border: 'none',
                    background: 'transparent',
                    padding: 0,
                    cursor: 'pointer'
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" role="img">
                    <circle cx="10" cy="10" r="8.5" fill="#ede9fe" stroke="#7c3aed" strokeWidth="1.2" />
                    <path d="M12.3 6.4C11.6 5.8 10.8 5.5 9.9 5.5C8 5.5 6.5 7 6.5 8.9C6.5 10.8 8 12.3 9.9 12.3C10.8 12.3 11.6 12 12.3 11.4" stroke="#7c3aed" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M12.8 11.5L14.6 13.3" stroke="#22c55e" strokeWidth="1.2" strokeLinecap="round" />
                    <path d="M14.6 11.5L12.8 13.3" stroke="#22c55e" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </span>
            <span
              className="commentable"
              onClick={(e) => onDataPointClick(e, key, value, label)}
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
      margin: '16px',
      fontFamily: 'Arial, sans-serif'
    }}>
      <div style={{
        background: 'var(--grey-200)',
        padding: '8px 12px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        cursor: 'pointer'
      }} onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Expand' : 'Collapse'}>
        <span style={{ fontSize: '8pt', fontWeight: 'bold' }}>
          Basic Information{collapsed ? ` — ${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.vin ? ' • ' + String(vehicle.vin).slice(0,8) + '…' : ''}` : ''}
        </span>
        {isVerifiedOwner && (
          <button
            onClick={(e) => { e.stopPropagation(); navigate(`/vehicle/${vehicle.id}/edit`); }}
            style={{
              background: 'var(--primary)',
              color: 'var(--white)',
              border: '1px solid var(--border)',
              borderRadius: '0px',
              padding: '4px 8px',
              fontSize: '8pt',
              cursor: 'pointer'
            }}
          >
            Edit
          </button>
        )}
      </div>
      {!collapsed && (
      <>
      {/* Data Quality Rating */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
        <VehicleDataQualityRating vehicleId={vehicle.id} />
      </div>

      {/* Inline VIN Editor (for contributors/owners) */}
      {hasContributorAccess && (
        <div style={{ padding: '12px', borderBottom: '1px solid #bdbdbd' }}>
          <InlineVINEditor
            vehicleId={vehicle.id}
            currentVIN={vehicle.vin || undefined}
            canEdit={true}
            onVINUpdated={() => {
              // refresh basic info
              window.dispatchEvent(new Event('vehicle_data_updated'));
            }}
          />
        </div>
      )}

      {/* BaT URL Drop (for contributors/owners) */}
      {hasContributorAccess && (
        <div style={{ padding: '12px', borderBottom: '1px solid #bdbdbd' }}>
          <BaTURLDrop
            vehicleId={vehicle.id}
            canEdit={true}
            onDataImported={() => window.location.reload()}
          />
        </div>
      )}

      {/* Vehicle Details */}
      <div style={{ padding: '12px' }}>
        <div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '4px 0',
            borderBottom: '1px solid var(--border)',
            fontSize: '8pt'
          }}>
            <span>Year</span>
            <span
              style={{ cursor: 'pointer', textDecoration: 'underline' }}
              onClick={(e) => onDataPointClick(e, 'year', vehicle.year?.toString() || '', 'Year')}
            >
              {vehicle.year}
            </span>
          </div>
          <div className="vehicle-detail">
            <span>Make</span>
            <span
              className="commentable"
              onClick={(e) => onDataPointClick(e, 'make', vehicle.make, 'Make')}
            >
              {vehicle.make}
            </span>
          </div>
          <div className="vehicle-detail">
            <span>Model</span>
            <span
              className="commentable"
              onClick={(e) => onDataPointClick(e, 'model', vehicle.model, 'Model')}
            >
              {vehicle.model}
            </span>
          </div>
          <div className="vehicle-detail">
            <span>VIN</span>
            <span
              className="commentable"
              onClick={(e) => onDataPointClick(e, 'vin', vehicle.vin || '', 'VIN')}
            >
              {vehicle.vin || 'Not provided'}
            </span>
          </div>
          <div className="vehicle-detail">
            <span>Color</span>
            <span
              className="commentable"
              onClick={(e) => onDataPointClick(e, 'color', vehicle.color || '', 'Color')}
            >
              {vehicle.color || 'Not specified'}
            </span>
          </div>
          <div className="vehicle-detail">
            <span>Mileage</span>
            <span
              className="commentable"
              onClick={(e) => onDataPointClick(e, 'mileage', vehicle.mileage?.toString() || '', 'Mileage')}
            >
              {vehicle.mileage ? `${vehicle.mileage.toLocaleString()} miles` : 'Not specified'}
            </span>
          </div>
          {vehicle.trim && (
            <div className="vehicle-detail">
              <span>Trim</span>
              <span
                className="commentable"
                onClick={(e) => onDataPointClick(e, 'trim', vehicle.trim || '', 'Trim')}
              >
                {vehicle.trim}
              </span>
            </div>
          )}
          {vehicle.engine && (
            <div className="vehicle-detail">
              <span>Engine</span>
              <span
                className="commentable"
                onClick={(e) => onDataPointClick(e, 'engine', vehicle.engine || '', 'Engine')}
              >
                {vehicle.engine}
              </span>
            </div>
          )}
          {vehicle.transmission && (
            <div className="vehicle-detail">
              <span>Transmission</span>
              <span
                className="commentable"
                onClick={(e) => onDataPointClick(e, 'transmission', vehicle.transmission || '', 'Transmission')}
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