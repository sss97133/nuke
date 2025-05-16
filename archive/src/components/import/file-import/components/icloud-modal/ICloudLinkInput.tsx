
import React from 'react';
import { Cloud, Check } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ICloudLinkInputProps {
  sharedAlbumLink: string;
  setSharedAlbumLink: (link: string) => void;
  linkValidation: 'valid' | 'invalid' | null;
  validateLink: () => boolean;
}

export const ICloudLinkInput: React.FC<ICloudLinkInputProps> = ({
  sharedAlbumLink,
  setSharedAlbumLink,
  linkValidation,
  validateLink
}) => {
  return (
    <div className="space-y-2">
      <Label htmlFor="icloud-link" className="text-base font-medium">
        <Cloud className="h-4 w-4 inline mr-2" />
        Connect iCloud Shared Album
      </Label>
      <Input
        id="icloud-link"
        placeholder="https://share.icloud.com/photos/..."
        value={sharedAlbumLink}
        onChange={(e) => setSharedAlbumLink(e.target.value)}
        onBlur={validateLink}
        className={`${
          linkValidation === 'valid' ? 'border-green-500 focus-visible:ring-green-500' :
          linkValidation === 'invalid' ? 'border-red-500 focus-visible:ring-red-500' : ''
        }`}
      />
      {linkValidation === 'valid' && (
        <p className="text-sm text-green-500 flex items-center">
          <Check className="h-4 w-4 mr-1" />
          Valid iCloud shared album link
        </p>
      )}
    </div>
  );
};
