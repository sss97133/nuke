import React from 'react';
import { HeadingWithDescription } from '@/components/ui/heading-with-description';
import SimpleImport from '@/components/vehicles/import/SimpleImport';

export default function VehicleImport() {
  return (
    <div className="container mx-auto py-6 space-y-6">
      <HeadingWithDescription
        heading="Import Vehicles"
        description="Import your vehicles from a CSV file"
      />
      <SimpleImport />
    </div>
  );
} 