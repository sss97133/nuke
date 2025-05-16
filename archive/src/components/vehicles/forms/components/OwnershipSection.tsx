import React from 'react';
import { UseFormReturn } from 'react-hook-form';
import { VehicleFormValues } from '../types';
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { FileUploader } from '@/components/detail/image-upload/FileUploader';
import { useDocumentUpload } from '../hooks/useDocumentUpload';
import { useToast } from '@/components/ui/toast/toast-context';
import { FileText, Car, AlertCircle } from 'lucide-react';

type OwnershipStatus = 'owned' | 'claimed' | 'discovered';

export const OwnershipSection = ({ form }: { form: UseFormReturn<VehicleFormValues> }) => {
  const ownershipStatus = form.watch('ownership_status');
  const { toast } = useToast();
  const { documents, setDocuments, handleDocumentsSelected } = useDocumentUpload({
    form,
    field: 'ownership_documents',
    onValidationError: (message) => {
      toast({
        title: 'Document Error',
        description: message,
        variant: 'destructive'
      });
    },
    onSuccess: (count) => {
      toast({
        title: 'Documents Added',
        description: `${count} document${count !== 1 ? 's' : ''} successfully uploaded.`,
        variant: 'success'
      });
    }
  });

  const renderOwnershipTypeIcon = () => {
    switch (ownershipStatus) {
      case 'owned':
        return <Car className="h-5 w-5 text-primary" />;
      case 'claimed':
        return <FileText className="h-5 w-5 text-yellow-500" />;
      case 'discovered':
        return <AlertCircle className="h-5 w-5 text-blue-500" />;
      default:
        return <Car className="h-5 w-5 text-primary" />;
    }
  };

  const getDocumentInstructions = () => {
    switch (ownershipStatus) {
      case 'owned':
        return 'Upload title, bill of sale, registration, or other proof of ownership.';
      case 'claimed':
        return 'Upload documentation supporting your claim to this vehicle.';
      case 'discovered':
        return 'Upload photos or documents from when you discovered this vehicle.';
      default:
        return 'Upload relevant documentation for this vehicle.';
    }
  };

  const getDocumentLabel = () => {
    switch (ownershipStatus) {
      case 'owned':
        return 'Ownership Documents';
      case 'claimed':
        return 'Claim Evidence';
      case 'discovered':
        return 'Discovery Documentation';
      default:
        return 'Vehicle Documents';
    }
  };

  const handleStatusChange = (newStatus: OwnershipStatus) => {
    if (documents.length > 0) {
      if (window.confirm('Changing the ownership status will clear any uploaded documents. Continue?')) {
        setDocuments([]);
        form.setValue('ownership_status', newStatus);
      }
    } else {
      form.setValue('ownership_status', newStatus);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center">
        <div className="mr-2">
          {renderOwnershipTypeIcon()}
        </div>
        <CardTitle>Ownership Information</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-6">
          <FormField
            control={form.control}
            name="ownership_status"
            render={({ field }) => (
              <FormItem className="space-y-3">
                <FormLabel>Ownership Status</FormLabel>
                <FormControl>
                  <RadioGroup
                    onValueChange={handleStatusChange}
                    defaultValue={field.value}
                    className="flex flex-col space-y-1"
                    value={field.value}
                  >
                    <FormItem className="flex items-center space-x-3 space-y-0">
                      <FormControl>
                        <RadioGroupItem value="owned" id="owned" />
                      </FormControl>
                      <FormLabel 
                        htmlFor="owned" 
                        className="font-normal cursor-pointer"
                        onClick={() => handleStatusChange('owned')}
                      >
                        I own this vehicle
                      </FormLabel>
                    </FormItem>
                    <FormItem className="flex items-center space-x-3 space-y-0">
                      <FormControl>
                        <RadioGroupItem value="claimed" id="claimed" />
                      </FormControl>
                      <FormLabel 
                        htmlFor="claimed" 
                        className="font-normal cursor-pointer"
                        onClick={() => handleStatusChange('claimed')}
                      >
                        I&apos;m claiming this vehicle
                      </FormLabel>
                    </FormItem>
                    <FormItem className="flex items-center space-x-3 space-y-0">
                      <FormControl>
                        <RadioGroupItem value="discovered" id="discovered" />
                      </FormControl>
                      <FormLabel 
                        htmlFor="discovered" 
                        className="font-normal cursor-pointer"
                        onClick={() => handleStatusChange('discovered')}
                      >
                        I discovered this vehicle
                      </FormLabel>
                    </FormItem>
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {ownershipStatus === 'owned' && (
            <div className="space-y-4 animate-fadeIn">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="purchase_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Purchase Date</FormLabel>
                      <FormControl>
                        <Input 
                          type="date" 
                          {...field} 
                          value={field.value || ''}
                          onChange={(e) => {
                            field.onChange(e);
                            // Add validation here if needed
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="purchase_price"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Purchase Price</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="e.g. $25,000" 
                          {...field} 
                          value={field.value || ''}
                          onChange={(e) => {
                            // Allow only numbers, commas, periods, and dollar sign
                            const value = e.target.value;
                            if (/^[$]?[0-9,]*\.?[0-9]*$/.test(value) || value === '') {
                              field.onChange(value);
                            }
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="purchase_location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Purchase Location</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="e.g. Dealer name, private sale" 
                        {...field} 
                        value={field.value || ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          {ownershipStatus === 'claimed' && (
            <div className="space-y-4 animate-fadeIn">
              <FormField
                control={form.control}
                name="claim_justification"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Claim Justification</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Explain why you&apos;re claiming this vehicle"
                        className="min-h-[100px]"
                        {...field}
                        value={field.value || ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          {ownershipStatus === 'discovered' && (
            <div className="space-y-4 animate-fadeIn">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="discovery_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Discovery Date</FormLabel>
                      <FormControl>
                        <Input 
                          type="date" 
                          {...field} 
                          value={field.value || ''}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="discovery_location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Discovery Location</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="e.g. Barn, storage facility" 
                          {...field} 
                          value={field.value || ''}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="discovery_notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Discovery Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Describe how you discovered this vehicle"
                        className="min-h-[100px]"
                        {...field}
                        value={field.value || ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}
          
          <div className="space-y-2 pt-4 border-t border-gray-200 dark:border-gray-800">
            <FormLabel>{getDocumentLabel()}</FormLabel>
            <FileUploader
              selectedFiles={documents}
              setSelectedFiles={setDocuments}
              onFilesSelected={handleDocumentsSelected}
              acceptedFileTypes={['image/*', 'application/pdf']}
              maxFiles={5}
              maxFileSize={10 * 1024 * 1024} // 10MB
              ariaLabel={`Upload ${getDocumentLabel()}`}
            />
            <FormDescription>
              {getDocumentInstructions()}
            </FormDescription>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

OwnershipSection.displayName = 'OwnershipSection';

export default OwnershipSection;
