
import React, { useCallback, useRef, useState } from 'react';
import { parseCarCsv, importCarsToSupabase, connectICloudImages, saveCarImages } from '@/utils/vehicle';
import { useToast } from "@/hooks/use-toast";
import { ICloudImageModal } from './ICloudImageModal';

// Import the new components
import { DropZone } from './components/DropZone';
import { FilePreview } from './components/FilePreview';
import { ImportedCarsList } from './components/ImportedCarsList';

interface FileDropZoneProps {
  selectedFile: File | null;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  resetImport: () => void;
  handleImport: () => void;
}

export const FileDropZone: React.FC<FileDropZoneProps> = ({
  selectedFile,
  handleFileChange,
  resetImport,
  handleImport
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isICloudModalOpen, setIsICloudModalOpen] = useState(false);
  const [importedCars, setImportedCars] = useState<any[]>([]);
  const [selectedCar, setSelectedCar] = useState<any>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConnectingImages, setIsConnectingImages] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleBrowseClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const processCsvImport = async () => {
    if (!selectedFile) return;
    
    setIsProcessing(true);
    try {
      // Parse the CSV file
      const carsData = await parseCarCsv(selectedFile);
      
      // Import cars to Supabase
      const importedIds = await importCarsToSupabase(carsData);
      
      if (importedIds.length > 0) {
        toast({
          title: "Import successful",
          description: `Imported ${importedIds.length} vehicles from CSV`,
        });
        
        // Find cars that have iCloud links
        const carsWithICloud = carsData.filter(car => car.icloud_album_link);
        
        // Connect iCloud albums if present
        if (carsWithICloud.length > 0) {
          for (const car of carsWithICloud) {
            if (car.id) {
              await connectICloudImages(
                car.id.toString(), 
                car.icloud_album_link, 
                car.icloud_folder_id
              );
            }
          }
          
          toast({
            title: "iCloud albums connected",
            description: `Connected ${carsWithICloud.length} vehicles to iCloud albums`,
          });
        }
        
        // Store the imported cars for further actions
        setImportedCars(carsData.map((car, index) => ({
          ...car,
          id: importedIds[index] || car.id
        })));
        
        handleImport();
      } else {
        toast({
          title: "Import failed",
          description: "No vehicles were imported. Please check your CSV format.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Import error",
        description: error.message || "An error occurred during import",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConnectImages = (car: any) => {
    setSelectedCar(car);
    setIsICloudModalOpen(true);
  };

  const handleImageConnection = async (data: {
    vehicleId: string;
    icloudLink?: string;
    icloudFolderId?: string;
    uploadedImages?: string[];
  }) => {
    setIsConnectingImages(true);
    
    try {
      // Connect iCloud album if provided
      if (data.icloudLink && data.icloudFolderId) {
        await connectICloudImages(
          data.vehicleId, 
          data.icloudLink,
          data.icloudFolderId
        );
        
        toast({
          title: "iCloud album connected",
          description: "Successfully connected vehicle to iCloud shared album",
        });
      }
      
      // Save uploaded images if provided
      if (data.uploadedImages && data.uploadedImages.length > 0) {
        await saveCarImages(data.vehicleId, data.uploadedImages);
        
        toast({
          title: "Images uploaded",
          description: `Successfully uploaded ${data.uploadedImages.length} images`,
        });
      }
    } catch (error: any) {
      toast({
        title: "Connection error",
        description: error.message || "An error occurred connecting images",
        variant: "destructive",
      });
    } finally {
      setIsConnectingImages(false);
    }
  };

  return (
    <div
      className={`border-2 ${isDragging ? 'border-primary bg-primary/5' : 'border-dashed'} rounded-lg p-6 text-center transition-colors`}
      onDragEnter={useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
      }, [setIsDragging])}
      onDragLeave={useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
      }, [setIsDragging])}
      onDragOver={useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
      }, [])}
      onDrop={useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          const event = {
            target: {
              files: e.dataTransfer.files
            }
          } as unknown as React.ChangeEvent<HTMLInputElement>;
          
          handleFileChange(event);
        }
      }, [handleFileChange, setIsDragging])}
    >
      {!selectedFile ? (
        <DropZone
          fileInputRef={fileInputRef}
          handleFileChange={handleFileChange}
          isDragging={isDragging}
          setIsDragging={setIsDragging}
          handleBrowseClick={handleBrowseClick}
        />
      ) : (
        <div className="space-y-2">
          <FilePreview
            file={selectedFile}
            resetImport={resetImport}
            processCsvImport={processCsvImport}
            isProcessing={isProcessing}
          />
          
          <ImportedCarsList 
            cars={importedCars}
            onConnectImages={handleConnectImages}
          />
        </div>
      )}
      
      {/* iCloud Image Connection Modal */}
      <ICloudImageModal
        open={isICloudModalOpen}
        onOpenChange={setIsICloudModalOpen}
        vehicleId={selectedCar?.id}
        vehicleInfo={selectedCar ? {
          make: selectedCar.make,
          model: selectedCar.model,
          year: selectedCar.year
        } : undefined}
        onConnect={handleImageConnection}
      />
    </div>
  );
};
