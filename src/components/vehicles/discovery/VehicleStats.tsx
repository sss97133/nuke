
import React from 'react';
import { Car, BarChart, Tag } from 'lucide-react';
import { Vehicle } from './types';

interface VehicleStatsProps {
  vehicles: Vehicle[];
  filteredCount: number;
}

const VehicleStats = ({ vehicles, filteredCount }: VehicleStatsProps) => {
  // Calculate total market value - now using filteredCount which represents the tab's filtered vehicles
  const totalMarketValue = vehicles.reduce((sum, vehicle) => sum + (vehicle.market_value || vehicle.price || 0), 0);
  
  // Count unique categories/tags
  const uniqueTags = new Set<string>();
  vehicles.forEach(vehicle => {
    if (vehicle.tags) {
      vehicle.tags.forEach(tag => uniqueTags.add(tag));
    }
  });
  
  return (
    <div className="flex justify-between items-center mb-4">
      <div className="text-sm text-muted-foreground">
        Showing <span className="font-medium">{filteredCount}</span> discovered vehicles
      </div>
      <div className="flex gap-4 text-sm">
        <div className="flex items-center gap-1">
          <Car className="h-4 w-4 text-primary" />
          <span>{filteredCount} vehicles</span>
        </div>
        <div className="flex items-center gap-1">
          <BarChart className="h-4 w-4 text-primary" />
          <span>Market value: ${totalMarketValue.toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-1">
          <Tag className="h-4 w-4 text-primary" />
          <span>{uniqueTags.size} categories</span>
        </div>
      </div>
    </div>
  );
};

export default VehicleStats;
