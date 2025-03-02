
import React from 'react';
import { ContentCard } from '../content/ContentCard';
import { GeoFencedDiscovery } from '../../discovery/GeoFencedDiscovery';

interface NearbyFeedProps {
  filter: string;
}

export const NearbyFeed = ({ filter }: NearbyFeedProps) => {
  return (
    <GeoFencedDiscovery contentType={filter === 'all' ? 'all' : filter as any} />
  );
};
