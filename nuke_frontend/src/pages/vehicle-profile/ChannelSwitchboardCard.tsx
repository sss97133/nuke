/**
 * ChannelSwitchboardCard.tsx
 * Profile-side wrapper: reads VehicleProfileContext and renders the generic
 * ChannelSwitchboard inside the standard widget shell, co-located with
 * Auction Readiness. Owner / lead contributor only. Self-guards (returns null)
 * when the viewer can't list — matches the AuctionReadinessPanel pattern.
 */

import React, { useState } from 'react';
import { useVehicleProfile } from './VehicleProfileContext';
import ChannelSwitchboard from '../../components/listing/ChannelSwitchboard';

const ChannelSwitchboardCard: React.FC = () => {
  const { vehicle, isRowOwner, isVerifiedOwner, hasContributorAccess } = useVehicleProfile();
  const [collapsed, setCollapsed] = useState(false);

  const canList = isRowOwner || isVerifiedOwner || hasContributorAccess;
  if (!vehicle?.id || !canList) return null;

  const askingPriceCents = (vehicle as any).asking_price
    ? Math.round(Number((vehicle as any).asking_price) * 100)
    : undefined;

  return (
    <div className={`widget ${collapsed ? 'widget--collapsed' : ''}`} id="widgetChannels">
      <div className="widget__header">
        <div className="widget__header-left">
          <span className="widget__label">Sales Channels</span>
        </div>
        <div className="widget__controls">
          <button className="widget__toggle" onClick={() => setCollapsed(!collapsed)} title="Toggle">
            {collapsed ? '▶' : '▼'}
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="widget__body">
          <ChannelSwitchboard vehicleId={vehicle.id} canList={canList} askingPriceCents={askingPriceCents} />
        </div>
      )}
    </div>
  );
};

export default ChannelSwitchboardCard;
