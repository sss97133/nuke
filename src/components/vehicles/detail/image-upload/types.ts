
export interface VehicleInfo {
  make: string;
  model: string;
  year: number | string;
}

export interface ImageUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpload: (files: FileList | null, type: string, description: string) => void;
  vehicleInfo?: VehicleInfo;
}

export interface ImagePreviewProps {
  previewUrls: string[];
  removePreview: (index: number) => void;
}

export interface ImageTypeSelectProps {
  imageType: string;
  setImageType: (value: string) => void;
}

export interface DescriptionInputProps {
  description: string;
  setDescription: (value: string) => void;
}

export interface FileUploaderProps {
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export interface ModalFooterProps {
  handleSubmit: () => void;
  hasSelectedFiles: boolean;
  onOpenChange: (open: boolean) => void;
}
