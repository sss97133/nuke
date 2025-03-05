
import { Dispatch, SetStateAction } from 'react';

export interface FileUploaderProps {
  selectedFiles: File[];
  setSelectedFiles: Dispatch<SetStateAction<File[]>>;
  onFilesSelected: (files: File[]) => void;
  acceptedFileTypes?: string[];
  maxFiles?: number;
  maxFileSize?: number;
  ariaLabel?: string;
}
