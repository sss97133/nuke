import React from 'react';
import { UseFormReturn } from 'react-hook-form';
import { FormField, FormItem, FormLabel, FormControl, FormDescription } from '@/components/ui/form';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { InfoIcon, GlobeIcon, UserIcon, ShieldCheckIcon } from 'lucide-react';
import { VehicleFormValues } from '../types';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { FileUploader } from './document-upload/FileUploader';
import { ImagePreview } from './document-upload/ImagePreview';
import { useDocumentUpload } from './document-upload/useDocumentUpload';

interface OwnershipSectionProps {
  form: UseFormReturn<VehicleFormValues>;
}

export const OwnershipSection: React.FC<OwnershipSectionProps> = ({ form }) => {
  const ownershipStatus = form.watch('ownership_status');
  
  // Initialize document upload hooks for different document types
  const titleDocuments = useDocumentUpload({
    form,
    fieldName: 'title_documents',
    maxFiles: 2
  });
  
  const identificationDocuments = useDocumentUpload({
    form,
    fieldName: 'identification_documents',
    maxFiles: 1
  });
  
  const authorizationDocuments = useDocumentUpload({
    form,
    fieldName: 'authorization_documents',
    maxFiles: 2
  });
  
  const discoveryEvidence = useDocumentUpload({
    form,
    fieldName: 'discovery_evidence',
    maxFiles: 5
  });
  
  return (
    <div className="space-y-6 bg-muted/30 p-6 rounded-lg border">
      <div className="flex items-start justify-between">
        <h3 className="text-lg font-semibold">Vehicle Ownership Status</h3>
        <div className="bg-muted p-4 rounded-lg text-sm max-w-md">
          <div className="flex gap-2 mb-2">
            <InfoIcon className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium mb-1">About vehicle ownership designations:</p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li><strong>Owned</strong>: You possess legal title in your name. Requires documentation to verify.</li>
                <li><strong>Claimed</strong>: You're representing the owner or awaiting title transfer. Ideal for brokers or collection managers.</li>
                <li><strong>Discovered</strong>: Vehicle you've found but don't possess. For tracking, research, or future acquisition.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <FormField
        control={form.control}
        name="ownership_status"
        render={({ field }) => (
          <FormItem className="space-y-3">
            <FormControl>
              <RadioGroup
                onValueChange={field.onChange}
                defaultValue={field.value}
                className="grid grid-cols-1 md:grid-cols-3 gap-4"
              >
                <div className={`flex flex-col space-y-2 border rounded-md p-4 ${field.value === 'owned' ? 'bg-primary/5 border-primary' : 'hover:bg-muted/50'}`}>
                  <RadioGroupItem value="owned" id="owned" className="sr-only" />
                  <div className="flex items-center gap-2">
                    <ShieldCheckIcon className="h-5 w-5 text-primary" />
                    <Label htmlFor="owned" className="font-medium text-base cursor-pointer">I own this vehicle</Label>
                  </div>
                  <p className="text-sm text-muted-foreground pl-7">
                    You have the title in your name and can prove ownership
                  </p>
                </div>
                
                <div className={`flex flex-col space-y-2 border rounded-md p-4 ${field.value === 'claimed' ? 'bg-primary/5 border-primary' : 'hover:bg-muted/50'}`}>
                  <RadioGroupItem value="claimed" id="claimed" className="sr-only" />
                  <div className="flex items-center gap-2">
                    <UserIcon className="h-5 w-5 text-amber-500" />
                    <Label htmlFor="claimed" className="font-medium text-base cursor-pointer">I'm claiming this vehicle</Label>
                  </div>
                  <p className="text-sm text-muted-foreground pl-7">
                    You represent the owner or are in the process of obtaining title
                  </p>
                </div>
                
                <div className={`flex flex-col space-y-2 border rounded-md p-4 ${field.value === 'discovered' ? 'bg-primary/5 border-primary' : 'hover:bg-muted/50'}`}>
                  <RadioGroupItem value="discovered" id="discovered" className="sr-only" />
                  <div className="flex items-center gap-2">
                    <GlobeIcon className="h-5 w-5 text-blue-500" />
                    <Label htmlFor="discovered" className="font-medium text-base cursor-pointer">I discovered this vehicle</Label>
                  </div>
                  <p className="text-sm text-muted-foreground pl-7">
                    You found this vehicle but don't have ownership rights
                  </p>
                </div>
              </RadioGroup>
            </FormControl>
            <FormDescription>
              Select the option that best describes your relationship to this vehicle
            </FormDescription>
          </FormItem>
        )}
      />

      {/* Conditional document uploads based on ownership status */}
      {ownershipStatus === 'owned' && (
        <div className="space-y-6 bg-background p-4 rounded-md border">
          <h4 className="font-medium">Ownership Verification Documents</h4>
          
          <div className="space-y-6">
            <div>
              <FileUploader 
                handleFileChange={titleDocuments.handleFileChange}
                label="Title Document (Front & Back)"
                description="Upload photos or scan of your vehicle title"
              />
              <ImagePreview 
                urls={titleDocuments.previewUrls} 
                onClearAll={titleDocuments.clearAllImages} 
                onClearImage={titleDocuments.clearImage} 
              />
            </div>
            
            <div>
              <FileUploader 
                handleFileChange={identificationDocuments.handleFileChange}
                label="ID/License"
                description="Upload a photo of your ID matching the name on title"
                maxFiles={1}
              />
              <ImagePreview 
                urls={identificationDocuments.previewUrls} 
                onClearAll={identificationDocuments.clearAllImages} 
                onClearImage={identificationDocuments.clearImage} 
              />
            </div>
          </div>
        </div>
      )}
      
      {ownershipStatus === 'claimed' && (
        <div className="space-y-6 bg-background p-4 rounded-md border">
          <h4 className="font-medium">Claim Authorization Documents (Optional)</h4>
          
          <div className="space-y-6">
            <div>
              <FileUploader 
                handleFileChange={authorizationDocuments.handleFileChange}
                label="Authorization Documents"
                description="Upload proof of authorization to represent this vehicle"
              />
              <ImagePreview 
                urls={authorizationDocuments.previewUrls} 
                onClearAll={authorizationDocuments.clearAllImages} 
                onClearImage={authorizationDocuments.clearImage} 
              />
            </div>
            
            <FormField
              control={form.control}
              name="claim_relationship"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Relationship to Vehicle/Owner</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      placeholder="e.g., Broker, Family member, Collection manager"
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>
        </div>
      )}
      
      {ownershipStatus === 'discovered' && (
        <div className="space-y-6 bg-background p-4 rounded-md border">
          <h4 className="font-medium">Discovery Information</h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="discovery_source"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Where did you find this vehicle?</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      placeholder="e.g., Auction, Website, In person"
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="discovery_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>When did you discover it?</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      type="date"
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="discovery_url"
              render={({ field }) => (
                <FormItem className="col-span-1 md:col-span-2">
                  <FormLabel>Source URL (if applicable)</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      type="url" 
                      placeholder="https://"
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            
            <div className="col-span-1 md:col-span-2">
              <FileUploader 
                handleFileChange={discoveryEvidence.handleFileChange}
                label="Screenshots or Photos (Optional)"
                description="Upload screenshots or photos of where you discovered this vehicle"
                maxFiles={5}
              />
              <ImagePreview 
                urls={discoveryEvidence.previewUrls} 
                onClearAll={discoveryEvidence.clearAllImages} 
                onClearImage={discoveryEvidence.clearImage} 
              />
            </div>
            
            <FormField
              control={form.control}
              name="discovery_notes"
              render={({ field }) => (
                <FormItem className="col-span-1 md:col-span-2">
                  <FormLabel>Discovery Notes</FormLabel>
                  <FormControl>
                    <Textarea 
                      {...field} 
                      placeholder="Any additional details about how you found this vehicle..."
                      rows={3}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>
        </div>
      )}
    </div>
  );
};
