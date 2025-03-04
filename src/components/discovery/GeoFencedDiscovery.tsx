
import React from 'react';
import { Card, CardContent } from "@/components/ui/card";

interface GeoFencedDiscoveryProps {
  contentType?: 'vehicles' | 'garages' | 'auctions' | 'events' | 'all';
}

export const GeoFencedDiscovery: React.FC<GeoFencedDiscoveryProps> = ({ contentType = 'all' }) => {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="bg-muted h-[300px] flex items-center justify-center">
          <p className="text-muted-foreground">
            Map discovery visualization for {contentType} will appear here
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
