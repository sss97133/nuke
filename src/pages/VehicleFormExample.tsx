import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { OwnershipSection, OwnershipData } from '../components/OwnershipSection';
import { useToast } from "@/components/ui/use-toast";
import { Loader2 } from 'lucide-react';

interface VehicleFormData {
  ownership: OwnershipData;
}

export default function VehicleFormExample() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [ownershipData, setOwnershipData] = useState<OwnershipData>({
    status: 'owned',
    documents: [],
  });

  const handleOwnershipChange = (data: OwnershipData) => {
    setOwnershipData(data);
  };

  const validateForm = (data: VehicleFormData): string | null => {
    if (!data.ownership.status) {
      return 'Vehicle ownership status is required';
    }
    if (data.ownership.status === 'owned' && data.ownership.documents.length === 0) {
      return 'Please upload at least one ownership document';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const formData: VehicleFormData = {
        ownership: ownershipData,
      };

      const validationError = validateForm(formData);
      if (validationError) {
        toast({
          variant: "destructive",
          title: "Validation Error",
          description: validationError,
        });
        return;
      }

      // In a real application, this would be an API call to your backend
      const response = await mockSaveVehicle(formData);

      if (response.success) {
        toast({
          title: "Success",
          description: "Vehicle information saved successfully!",
        });
        handleCancel();
      } else {
        throw new Error('Failed to save vehicle');
      }
    } catch (error) {
      console.error('Error saving vehicle:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to save vehicle information. Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Mock API function
  const mockSaveVehicle = async (data: VehicleFormData) => {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    return { success: true, data };
  };

  const handleCancel = () => {
    setOwnershipData({
      status: 'owned',
      documents: [],
    });
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
              <Button 
                type="button" 
                variant="outline" 
                onClick={handleCancel}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Vehicle'
                )}
              </Button>
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
