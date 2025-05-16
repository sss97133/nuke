
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface VehicleRelationshipsSectionProps {
  userId: string;
}

const VehicleRelationshipsSection: React.FC<VehicleRelationshipsSectionProps> = ({ userId }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Vehicle Relationships</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground mb-4">
          This section shows your relationships with various vehicles. This component is currently being implemented.
        </p>
        <div className="grid gap-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </CardContent>
    </Card>
  );
};

export default VehicleRelationshipsSection;
