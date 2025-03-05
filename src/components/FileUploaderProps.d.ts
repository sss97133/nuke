
import { Dispatch, SetStateAction } from 'react';

export interface FileUploaderProps {
  /**
   * The currently selected files
   */
  selectedFiles?: File[];
  
  /**
   * Function to update the selected files
   */
  setSelectedFiles?: Dispatch<SetStateAction<File[]>>;
  
  /**
   * Callback when files are selected
   */
  onFilesSelected?: (files: File[]) => void;
  
  /**
   * Maximum number of files that can be uploaded
   */
  maxFiles?: number;
  
  /**
   * Accepted file types
   */
  acceptedFileTypes?: string[];
  
  /**
   * Placeholder text
   */
  placeholder?: string;
  
  /**
   * Is the uploader disabled
   */
  disabled?: boolean;
}
