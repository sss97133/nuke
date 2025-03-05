import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { OwnershipSection, OwnershipData } from '../components/OwnershipSection';

export default function VehicleFormExample() {
  const [ownershipData, setOwnershipData] = useState<OwnershipData>({
    status: 'owned',
    documents: [],
  });

  const handleOwnershipChange = (data: OwnershipData) => {
    setOwnershipData(data);
    console.log('Updated ownership data:', data);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // In a real application, you would submit the form data to your backend
    console.log('Form submitted with data:', {
      ownership: ownershipData,
    });

    // Show success message or redirect user
    alert('Vehicle information saved successfully!');
  };

  return (
    <div className="container max-w-4xl py-10 space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Vehicle Information</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Ownership Section */}
            <OwnershipSection
              value={ownershipData}
              onChange={handleOwnershipChange}
            />

            {/* Form Actions */}
            <div className="flex justify-end gap-4">
              <Button type="button" variant="outline">
                Cancel
              </Button>
              <Button type="submit">Save Vehicle</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Debug Info - Remove in production */}
      {process.env.NODE_ENV === 'development' && (
        <Card className="bg-gray-50 dark:bg-gray-900 border-dashed">
          <CardHeader>
            <CardTitle className="text-sm">Current Form Data (Debug)</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs overflow-auto p-4 bg-gray-100 dark:bg-gray-800 rounded-md">
              {JSON.stringify(
                {
                  ownership: {
                    ...ownershipData,
                    documents: ownershipData.documents?.map(f => ({
                      name: f.name,
                      size: f.size,
                      type: f.type,
                    })),
                  },
                },
                null,
                2
              )}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
