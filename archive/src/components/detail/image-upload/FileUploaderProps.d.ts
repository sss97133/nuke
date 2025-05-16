
interface FileUploaderProps {
  selectedFiles?: File[];
  setSelectedFiles?: React.Dispatch<React.SetStateAction<File[]>>;
  onFilesSelected?: (files: File[]) => void;
  acceptedFileTypes?: string[];
  maxFiles?: number;
  multiple?: boolean;
}
