import React from 'react';
import { UseFormReturn } from 'react-hook-form';
import { VehicleFormValues } from '../types';
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FileUploader } from '@/components/detail/image-upload/FileUploader';
import { useDocumentUpload } from '../hooks/useDocumentUpload';

export const OwnershipSection = ({ form }: { form: UseFormReturn<VehicleFormValues> }) => {
  const ownershipStatus = form.watch('ownership_status');
  const { documents, setDocuments, handleDocumentsSelected } = useDocumentUpload({
    form,
    field: 'ownership_documents'
  });

  return (
    <Card className="w-full">
      <CardContent className="pt-6">
        <div className="space-y-6">
          <FormField
            control={form.control}
            name="ownership_status"
            render={({ field }) => (
              <FormItem className="space-y-3">
                <FormLabel>Ownership Status</FormLabel>
                <FormControl>
                  <RadioGroup
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    className="flex flex-col space-y-1"
                  >
                    <FormItem className="flex items-center space-x-3 space-y-0">
                      <FormControl>
                        <RadioGroupItem value="owned" />
                      </FormControl>
                      <FormLabel className="font-normal">
                        I own this vehicle
                      </FormLabel>
                    </FormItem>
                    <FormItem className="flex items-center space-x-3 space-y-0">
                      <FormControl>
                        <RadioGroupItem value="claimed" />
                      </FormControl>
                      <FormLabel className="font-normal">
                        I'm claiming this vehicle
                      </FormLabel>
                    </FormItem>
                    <FormItem className="flex items-center space-x-3 space-y-0">
                      <FormControl>
                        <RadioGroupItem value="discovered" />
                      </FormControl>
                      <FormLabel className="font-normal">
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
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="purchase_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Purchase Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
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
                        <Input placeholder="e.g. $25,000" {...field} />
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
                      <Input placeholder="e.g. Dealer name, private sale" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="space-y-2">
                <FormLabel>Ownership Documents</FormLabel>
                <FileUploader
                  selectedFiles={documents}
                  setSelectedFiles={setDocuments}
                  onFilesSelected={handleDocumentsSelected}
                  acceptedFileTypes={['image/*', 'application/pdf']}
                  maxFiles={5}
                />
                <FormDescription>
                  Upload title, bill of sale, registration, or other proof of ownership.
                </FormDescription>
              </div>
            </div>
          )}

          {ownershipStatus === 'claimed' && (
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="claim_justification"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Claim Justification</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Explain why you're claiming this vehicle"
                        className="min-h-[100px]"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="space-y-2">
                <FormLabel>Claim Evidence</FormLabel>
                <FileUploader
                  selectedFiles={documents}
                  setSelectedFiles={setDocuments}
                  onFilesSelected={handleDocumentsSelected}
                  acceptedFileTypes={['image/*', 'application/pdf']}
                  maxFiles={5}
                />
                <FormDescription>
                  Upload documentation supporting your claim to this vehicle.
                </FormDescription>
              </div>
            </div>
          )}

          {ownershipStatus === 'discovered' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="discovery_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Discovery Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
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
                        <Input placeholder="e.g. Barn, storage facility" {...field} />
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
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="space-y-2">
                <FormLabel>Discovery Documentation</FormLabel>
                <FileUploader
                  selectedFiles={documents}
                  setSelectedFiles={setDocuments}
                  onFilesSelected={handleDocumentsSelected}
                  acceptedFileTypes={['image/*', 'application/pdf']}
                  maxFiles={5}
                />
                <FormDescription>
                  Upload photos or documents from when you discovered this vehicle.
                </FormDescription>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
