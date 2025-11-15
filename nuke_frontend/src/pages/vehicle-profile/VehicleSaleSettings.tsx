import React from 'react';
import VehicleResults from '../../components/VehicleResults';
import BuyVehicleButton from '../../components/BuyVehicleButton';
import type { VehicleSaleSettingsProps } from './types';

const VehicleSaleSettings: React.FC<VehicleSaleSettingsProps> = ({
  vehicle,
  session,
  permissions,
  saleSettings,
  savingSale,
  viewCount,
  onSaleSettingsChange,
  onSaveSaleSettings,
  onShowCompose
}) => {
  const composeListingForPartner = (partnerKey: string) => {
    // This would be moved to parent component or a custom hook
    onShowCompose();
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  return (
    <div className="grid grid-cols-2">
      {/* Vehicle Metadata */}
      <div className="card">
        <div className="card-header">Vehicle Metadata</div>
        <div className="card-body">
          <div className="vehicle-details">
            <div className="vehicle-detail">
              <span>Ownership Status</span>
              <span>
                {vehicle.ownership_type ? (
                  <span className="badge badge-primary">{vehicle.ownership_type}</span>
                ) : (
                  <span className="badge badge-secondary">Not Specified</span>
                )}
              </span>
            </div>
            <div className="vehicle-detail">
              <span>Profile Views</span>
              <span className="badge badge-info">{viewCount.toLocaleString()}</span>
            </div>
            <div className="vehicle-detail">
              <span>Added</span>
              <span>{formatDate(vehicle.created_at)}</span>
            </div>
            <div className="vehicle-detail">
              <span>Last Updated</span>
              <span>{formatDate(vehicle.updated_at)}</span>
            </div>
            <div className="vehicle-detail">
              <span>Storage</span>
              <span>
                {vehicle.isAnonymous ? (
                  <span className="badge badge-secondary">Local Browser</span>
                ) : (
                  <span className="badge badge-primary">Cloud Database</span>
                )}
              </span>
            </div>
            <div className="vehicle-detail">
              <span>Vehicle ID</span>
              <span className="text-small">{vehicle.id}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Sale & Distribution */}
      <div className="card">
        <div className="card-header">Sale & Distribution</div>
        <div className="card-body">
          {/* For Sale Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <label className="text">
              <input
                type="checkbox"
                checked={saleSettings.for_sale}
                onChange={(e) => onSaleSettingsChange({ ...saleSettings, for_sale: e.target.checked })}
              />
              <span style={{ marginLeft: 6 }}>For Sale</span>
            </label>
            <label className="text">
              <input
                type="checkbox"
                checked={saleSettings.live_auction}
                onChange={(e) => onSaleSettingsChange({
                  ...saleSettings,
                  live_auction: e.target.checked,
                  for_sale: e.target.checked || saleSettings.for_sale
                })}
              />
              <span style={{ marginLeft: 6 }}>Nuke Live Auction</span>
            </label>
          </div>

          {/* Reserve price */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span className="text-small text-muted">Reserve</span>
            <input
              type="number"
              className="text-xs border rounded px-2 py-1"
              placeholder="e.g. 25000"
              value={saleSettings.reserve}
              onChange={(e) => onSaleSettingsChange({
                ...saleSettings,
                reserve: e.target.value === '' ? '' : Number(e.target.value)
              })}
              style={{ width: 140 }}
            />
          </div>

          {/* Partner checkboxes */}
          <div className="text-small text-muted" style={{ marginBottom: 6 }}>
            Submit listing package to partners
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
            {[
              { k: 'bring_a_trailer', l: 'Bring a Trailer' },
              { k: 'cars_and_bids', l: 'Cars & Bids' },
              { k: 'ebay_motors', l: 'eBay Motors' },
              { k: 'facebook_marketplace', l: 'Facebook Marketplace' },
              { k: 'hemmings', l: 'Hemmings' },
              { k: 'hagerty', l: 'Hagerty' },
              { k: 'sothebys', l: 'RM Sotheby\'s' },
              { k: 'christies', l: 'Christie\'s' },
              { k: 'pebble_beach', l: 'Pebble Beach' },
              { k: 'local_auctioneer_generic', l: 'Local Auctioneer' },
            ].map(p => (
              <label key={p.k} className="text" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={saleSettings.partners.includes(p.k)}
                  onChange={(e) => onSaleSettingsChange({
                    ...saleSettings,
                    partners: e.target.checked
                      ? Array.from(new Set([...(saleSettings.partners || []), p.k]))
                      : (saleSettings.partners || []).filter(x => x !== p.k)
                  })}
                />
                <span>{p.l}</span>
              </label>
            ))}
          </div>

          {/* Show sale settings to owner */}
          {permissions?.isVerifiedOwner && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="button button-primary" disabled={savingSale} onClick={onSaveSaleSettings}>
                {savingSale ? 'Saving…' : 'Save Sale Settings'}
              </button>
              <button className="button" onClick={() => composeListingForPartner('bring_a_trailer')}>
                Compose & Autofill
              </button>
            </div>
          )}

          {/* Show buy button to non-owners when vehicle is for sale */}
          {!permissions?.isVerifiedOwner && vehicle.is_for_sale && vehicle.asking_price && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <BuyVehicleButton
                vehicleId={vehicle.id}
                salePrice={vehicle.asking_price}
                vehicleName={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
              />
            </div>
          )}

          {/* Existing market summary (read-only) */}
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12 }}>
            <VehicleResults
              vehicleId={vehicle.id}
              salePrice={vehicle.sale_price}
              auctionEndDate={vehicle.auction_end_date}
              bidCount={vehicle.bid_count}
              viewCount={vehicle.view_count}
              auctionSource={vehicle.auction_source}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default VehicleSaleSettings;