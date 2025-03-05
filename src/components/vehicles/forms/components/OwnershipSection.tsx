
import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { UseFormReturn } from 'react-hook-form';
import { VehicleFormValues } from '../types';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Info, ShieldCheck, Search, User, Flag, Upload, Link, Camera, FileText, FileCheck, Lock, CreditCard } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useImageUpload } from '../components/image-upload/useImageUpload';
import { FileUploader } from '../../../detail/image-upload/FileUploader';
import { ImagePreview } from '../../../detail/image-upload/ImagePreview';

interface OwnershipSectionProps {
  form: UseFormReturn<VehicleFormValues>;
}

export const OwnershipSection: React.FC<OwnershipSectionProps> = ({ form }) => {
  const ownershipStatus = form.watch('ownership_status');
  
  const handleOwnershipChange = (value: string) => {
    // Reset discovery fields when changing from discovered to other status
    if (value !== 'discovered') {
      form.setValue('discovery_source', '');
      form.setValue('discovery_url', '');
      form.setValue('discovery_location', '');
    }
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Vehicle Ownership</h3>
          
          <FormField
            control={form.control}
            name="ownership_status"
            defaultValue="owned"
            render={({ field }) => (
              <FormItem className="space-y-3">
                <FormLabel>What is your relationship with this vehicle?</FormLabel>
                <FormControl>
                  <RadioGroup
                    onValueChange={(value) => {
                      field.onChange(value);
                      handleOwnershipChange(value);
                    }}
                    defaultValue={field.value}
                    className="flex flex-col space-y-2"
                  >
                    <div className="flex items-center space-x-2 p-2 rounded hover:bg-muted/50">
                      <RadioGroupItem value="owned" id="owned" />
                      <Label htmlFor="owned" className="flex items-center gap-2 cursor-pointer">
                        <ShieldCheck className="h-4 w-4 text-primary" />
                        <span>I own this vehicle (verified with documentation)</span>
                      </Label>
                    </div>
                    
                    <div className="flex items-center space-x-2 p-2 rounded hover:bg-muted/50">
                      <RadioGroupItem value="claimed" id="claimed" />
                      <Label htmlFor="claimed" className="flex items-center gap-2 cursor-pointer">
                        <User className="h-4 w-4 text-amber-500" />
                        <span>I claim this vehicle (acting on owner's behalf)</span>
                      </Label>
                    </div>
                    
                    <div className="flex items-center space-x-2 p-2 rounded hover:bg-muted/50">
                      <RadioGroupItem value="discovered" id="discovered" />
                      <Label htmlFor="discovered" className="flex items-center gap-2 cursor-pointer">
                        <Search className="h-4 w-4 text-blue-500" />
                        <span>I discovered this vehicle (tracking only)</span>
                      </Label>
                    </div>
                  </RadioGroup>
                </FormControl>
                
                <div className="bg-muted/50 p-3 rounded-md flex items-start gap-2">
                  <Info className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-muted-foreground space-y-2">
                    <p><strong>Ownership (Verified):</strong> You have proof of title in your name and can provide documentation if needed. This is the highest level of verification.</p>
                    
                    <p><strong>Claim (Unverified):</strong> You represent the owner (as a broker, collection manager, family member) or the title is not yet in your name but the vehicle is in your possession.</p>
                    
                    <p><strong>Discovery (Tracking):</strong> You've found this vehicle elsewhere (online listing, in person) and want to track it for reference. Source information is required for discovered vehicles.</p>
                  </div>
                </div>
                
                <FormMessage />
              </FormItem>
            )}
          />
          
          {/* Conditional document upload section based on ownership status */}
          {ownershipStatus === 'owned' && (
            <OwnershipVerificationSection form={form} />
          )}
          
          {ownershipStatus === 'claimed' && (
            <ClaimVerificationSection form={form} />
          )}
          
          {ownershipStatus === 'discovered' && (
            <DiscoverySourceSection form={form} />
          )}
        </div>
      </CardContent>
    </Card>
  );
};

// Component for uploading ownership verification documents
const OwnershipVerificationSection: React.FC<{ form: UseFormReturn<VehicleFormValues> }> = ({ form }) => {
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setSelectedFiles(files);
    
    // Generate previews
    const urls: string[] = [];
    Array.from(files).forEach(file => {
      urls.push(URL.createObjectURL(file));
    });
    setPreviewUrls(urls);
  };
  
  const removePreview = (index: number) => {
    URL.revokeObjectURL(previewUrls[index]);
    setPreviewUrls(prev => prev.filter((_, i) => i !== index));
  };
  
  return (
    <div className="space-y-4 border border-green-200 rounded-md p-4 bg-green-50">
      <div className="flex items-center gap-2 text-green-700">
        <FileCheck className="h-5 w-5" />
        <h4 className="font-medium">Ownership Verification</h4>
      </div>
      
      <p className="text-sm text-muted-foreground">
        Please upload clear photos of your vehicle title (front and back) and a valid government-issued ID to verify ownership.
      </p>
      
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="title-upload" className="flex items-center gap-2 mb-2">
            <FileText className="h-4 w-4" />
            Vehicle Title (Front & Back)
          </Label>
          <FileUploader 
            handleFileChange={handleFileChange}
            maxFiles={2}
            maxSizeInMB={5}
          />
        </div>
        
        <div>
          <Label htmlFor="id-upload" className="flex items-center gap-2 mb-2">
            <CreditCard className="h-4 w-4" />
            Government ID
          </Label>
          <FileUploader 
            handleFileChange={handleFileChange}
            maxFiles={1}
            maxSizeInMB={5}
          />
        </div>
      </div>
      
      <ImagePreview previewUrls={previewUrls} removePreview={removePreview} />
      
      <div className="text-sm text-muted-foreground flex items-center gap-2">
        <Lock className="h-4 w-4" />
        <span>Your documents are securely stored and only used for verification purposes.</span>
      </div>
    </div>
  );
};

// Component for claimed vehicle verification
const ClaimVerificationSection: React.FC<{ form: UseFormReturn<VehicleFormValues> }> = ({ form }) => {
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setSelectedFiles(files);
    
    // Generate previews
    const urls: string[] = [];
    Array.from(files).forEach(file => {
      urls.push(URL.createObjectURL(file));
    });
    setPreviewUrls(urls);
  };
  
  const removePreview = (index: number) => {
    URL.revokeObjectURL(previewUrls[index]);
    setPreviewUrls(prev => prev.filter((_, i) => i !== index));
  };
  
  return (
    <div className="space-y-4 border border-amber-200 rounded-md p-4 bg-amber-50">
      <div className="flex items-center gap-2 text-amber-700">
        <User className="h-5 w-5" />
        <h4 className="font-medium">Claim Authorization</h4>
      </div>
      
      <p className="text-sm text-muted-foreground">
        Since you're claiming this vehicle on behalf of the owner, please upload any relevant authorization documentation (optional but recommended).
      </p>
      
      <div>
        <Label htmlFor="authorization-upload" className="flex items-center gap-2 mb-2">
          <FileText className="h-4 w-4" />
          Authorization Documents (Optional)
        </Label>
        <FileUploader 
          handleFileChange={handleFileChange}
          maxFiles={3}
          maxSizeInMB={5}
        />
      </div>
      
      <ImagePreview previewUrls={previewUrls} removePreview={removePreview} />
      
      <div className="text-sm text-muted-foreground flex items-center gap-2">
        <Info className="h-4 w-4" />
        <span>You can verify ownership with documentation later to change the status to "Owned".</span>
      </div>
    </div>
  );
};

// Component for discovery source information
const DiscoverySourceSection: React.FC<{ form: UseFormReturn<VehicleFormValues> }> = ({ form }) => {
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setSelectedFiles(files);
    
    // Generate previews
    const urls: string[] = [];
    Array.from(files).forEach(file => {
      urls.push(URL.createObjectURL(file));
    });
    setPreviewUrls(urls);
  };
  
  const removePreview = (index: number) => {
    URL.revokeObjectURL(previewUrls[index]);
    setPreviewUrls(prev => prev.filter((_, i) => i !== index));
  };
  
  return (
    <div className="space-y-4 border border-blue-200 rounded-md p-4 bg-blue-50">
      <div className="flex items-center gap-2 text-blue-700">
        <Search className="h-5 w-5" />
        <h4 className="font-medium">Discovery Source</h4>
      </div>
      
      <p className="text-sm text-muted-foreground">
        Please provide information about where you discovered this vehicle. This helps with tracking and verification.
      </p>
      
      <div className="space-y-4">
        <FormField
          control={form.control}
          name="discovery_source"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                <Flag className="h-4 w-4" />
                Discovery Source
              </FormLabel>
              <FormControl>
                <Input placeholder="e.g., Craigslist, Facebook Marketplace, Car Show, etc." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="discovery_url"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                <Link className="h-4 w-4" />
                URL (if applicable)
              </FormLabel>
              <FormControl>
                <Input placeholder="https://..." {...field} />
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
              <FormLabel className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Discovery Location
              </FormLabel>
              <FormControl>
                <Input placeholder="City, State or Address" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <div>
          <Label htmlFor="discovery-upload" className="flex items-center gap-2 mb-2">
            <Camera className="h-4 w-4" />
            Upload Screenshots or Photos
          </Label>
          <FileUploader 
            handleFileChange={handleFileChange}
            maxFiles={5}
            maxSizeInMB={10}
          />
        </div>
        
        <ImagePreview previewUrls={previewUrls} removePreview={removePreview} />
      </div>
    </div>
  );
};
