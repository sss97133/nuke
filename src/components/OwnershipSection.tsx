import React, { useState } from 'react';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { FileUploader } from './FileUploader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

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
  value: OwnershipData;
  onChange: (data: OwnershipData) => void;
}

export function OwnershipSection({ value, onChange }: OwnershipSectionProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>(value.documents || []);

  const handleStatusChange = (status: OwnershipStatus) => {
    onChange({ ...value, status });
  };

  const handleDocumentsChange = (files: File[]) => {
    onChange({ ...value, documents: files });
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value: inputValue } = e.target;
    onChange({ ...value, [name]: inputValue });
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Ownership Information</CardTitle>
        <CardDescription>
          Provide details about how you acquired this vehicle
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <Label htmlFor="ownership-status">Ownership Status</Label>
          <RadioGroup
            id="ownership-status"
            value={value.status}
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

        {value.status === 'owned' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="purchaseDate">Purchase Date</Label>
                <Input
                  id="purchaseDate"
                  name="purchaseDate"
                  type="date"
                  value={value.purchaseDate || ''}
                  onChange={handleInputChange}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="purchasePrice">Purchase Price</Label>
                <Input
                  id="purchasePrice"
                  name="purchasePrice"
                  type="text"
                  placeholder="e.g. $25,000"
                  value={value.purchasePrice || ''}
                  onChange={handleInputChange}
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
                value={value.purchaseLocation || ''}
                onChange={handleInputChange}
              />
            </div>
          </div>
        )}

        {value.status === 'discovered' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="discoveryDate">Discovery Date</Label>
                <Input
                  id="discoveryDate"
                  name="discoveryDate"
                  type="date"
                  value={value.discoveryDate || ''}
                  onChange={handleInputChange}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="discoveryLocation">Discovery Location</Label>
                <Input
                  id="discoveryLocation"
                  name="discoveryLocation"
                  type="text"
                  placeholder="e.g. Barn, storage facility, etc."
                  value={value.discoveryLocation || ''}
                  onChange={handleInputChange}
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
                value={value.discoveryNotes || ''}
                onChange={handleInputChange}
              />
            </div>
          </div>
        )}

        <div className="space-y-3">
          <Label>
            {value.status === 'owned'
              ? 'Upload Ownership Documents'
              : value.status === 'claimed'
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
            {value.status === 'owned'
              ? 'Upload title, bill of sale, registration, or other proof of ownership.'
              : value.status === 'claimed'
              ? 'Upload documentation supporting your claim to this vehicle.'
              : 'Upload photos or documents from when you discovered this vehicle.'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
