
import React from 'react';
import { ContentCard } from '../content/ContentCard';
import { GeoFencedDiscovery } from '../../discovery/GeoFencedDiscovery';

interface NearbyFeedProps {
  filter: string;
}

export const NearbyFeed = ({ filter }: NearbyFeedProps) => {
  // Convert filter to a valid contentType
  const contentType = filter === 'all' ? 'all' : 
                      filter === 'vehicles' ? 'vehicles' :
                      filter === 'garages' ? 'garages' :
                      filter === 'auctions' ? 'auctions' :
                      filter === 'events' ? 'events' : 'all';
  
  return (
    <GeoFencedDiscovery contentType={contentType as 'all' | 'vehicles' | 'garages' | 'auctions' | 'events'} />
  );
};
