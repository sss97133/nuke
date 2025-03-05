import React, { useState } from 'react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Info, ShieldCheck, Search, User, Flag, Upload, Link, Camera, FileText, FileCheck, Lock, CreditCard } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { FileUploader } from '../../../detail/image-upload/FileUploader';
import { ImagePreview } from '../../../detail/image-upload/ImagePreview';

export type OwnershipStatus = 'owned' | 'claimed' | 'discovered';

export interface OwnershipData {
  status: OwnershipStatus;
  documents: File[];
  purchaseDate?: string;
  purchasePrice?: string;
  purchaseLocation?: string;
  discoveryDate?: string;
  discoveryLocation?: string;
  discoveryNotes?: string;
}

interface OwnershipSectionProps {
  form: {
    getValues: () => any;
    setValue: (name: string, value: any) => void;
    watch: (name: string) => any;
  };
}

export const OwnershipSection = ({ form }: OwnershipSectionProps) => {
  const ownershipStatus = form.watch('ownershipStatus') || 'owned';
  const [selectedFiles, setSelectedFiles] = useState<File[]>(form.watch('documents') || []);

  const handleStatusChange = (status: OwnershipStatus) => {
    form.setValue('ownershipStatus', status);
  };

  const handleDocumentsChange = (files: File[]) => {
    form.setValue('documents', files);
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileCheck className="h-5 w-5" />
          Ownership Information
        </CardTitle>
        <CardDescription>
          Provide details about how you acquired this vehicle
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <Label htmlFor="ownership-status">Ownership Status</Label>
          <RadioGroup
            id="ownership-status"
            value={ownershipStatus}
            onValueChange={(val) => handleStatusChange(val as OwnershipStatus)}
            className="flex flex-col space-y-2"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="owned" id="owned" />
              <Label htmlFor="owned" className="cursor-pointer">Owned</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="claimed" id="claimed" />
              <Label htmlFor="claimed" className="cursor-pointer">Claimed</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="discovered" id="discovered" />
              <Label htmlFor="discovered" className="cursor-pointer">Discovered</Label>
            </div>
          </RadioGroup>
        </div>

        {ownershipStatus === 'owned' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="purchaseDate">Purchase Date</Label>
                <Input
                  id="purchaseDate"
                  name="purchaseDate"
                  type="date"
                  defaultValue={form.getValues('purchaseDate') || ''}
                  onChange={(e) => form.setValue('purchaseDate', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="purchasePrice">Purchase Price</Label>
                <Input
                  id="purchasePrice"
                  name="purchasePrice"
                  type="text"
                  placeholder="e.g. $25,000"
                  defaultValue={form.getValues('purchasePrice') || ''}
                  onChange={(e) => form.setValue('purchasePrice', e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="purchaseLocation">Purchase Location</Label>
              <Input
                id="purchaseLocation"
                name="purchaseLocation"
                type="text"
                placeholder="e.g. Dealer name, private sale, etc."
                defaultValue={form.getValues('purchaseLocation') || ''}
                onChange={(e) => form.setValue('purchaseLocation', e.target.value)}
              />
            </div>
          </div>
        )}

        {ownershipStatus === 'discovered' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="discoveryDate">Discovery Date</Label>
                <Input
                  id="discoveryDate"
                  name="discoveryDate"
                  type="date"
                  defaultValue={form.getValues('discoveryDate') || ''}
                  onChange={(e) => form.setValue('discoveryDate', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="discoveryLocation">Discovery Location</Label>
                <Input
                  id="discoveryLocation"
                  name="discoveryLocation"
                  type="text"
                  placeholder="e.g. Barn, storage facility, etc."
                  defaultValue={form.getValues('discoveryLocation') || ''}
                  onChange={(e) => form.setValue('discoveryLocation', e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="discoveryNotes">Discovery Notes</Label>
              <Textarea
                id="discoveryNotes"
                name="discoveryNotes"
                placeholder="Describe how you discovered this vehicle"
                rows={3}
                defaultValue={form.getValues('discoveryNotes') || ''}
                onChange={(e) => form.setValue('discoveryNotes', e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="space-y-3">
          <Label>
            {ownershipStatus === 'owned'
              ? 'Upload Ownership Documents'
              : ownershipStatus === 'claimed'
              ? 'Upload Claim Evidence'
              : 'Upload Discovery Documentation'}
          </Label>
          <FileUploader
            selectedFiles={selectedFiles}
            setSelectedFiles={setSelectedFiles}
            onFilesSelected={handleDocumentsChange}
            acceptedFileTypes={['image/*', 'application/pdf']}
            maxFiles={5}
          />
          <p className="text-sm text-gray-500">
            {ownershipStatus === 'owned'
              ? 'Upload title, bill of sale, registration, or other proof of ownership.'
              : ownershipStatus === 'claimed'
              ? 'Upload documentation supporting your claim to this vehicle.'
              : 'Upload photos or documents from when you discovered this vehicle.'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
