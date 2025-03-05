
import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

interface VehicleRelationshipsSectionProps {
  userId: string;
}

export const VehicleRelationshipsSection = ({ userId }: VehicleRelationshipsSectionProps) => {
  return (
    <Card>
      <CardContent className="p-6">
        <h3 className="font-semibold mb-4">Vehicle Relationships</h3>
        <p className="text-muted-foreground">
          This section will show relationships between users and vehicles.
        </p>
      </CardContent>
    </Card>
  );
};

export default VehicleRelationshipsSection;
