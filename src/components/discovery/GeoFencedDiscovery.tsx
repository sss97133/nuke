
import React from 'react';
import { Card, CardContent } from "@/components/ui/card";

export const GeoFencedDiscovery: React.FC = () => {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="bg-muted h-[300px] flex items-center justify-center">
          <p className="text-muted-foreground">Map discovery visualization will appear here</p>
        </div>
      </CardContent>
    </Card>
  );
};
