
import React, { useCallback, useRef, useState } from 'react';
import { Upload, FileText, UploadCloud, Cloud, Check } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ICloudImageModal } from './ICloudImageModal';
import { parseCarCsv, importCarsToSupabase, connectICloudImages, saveCarImages } from '@/utils/vehicle';
import { useToast } from "@/hooks/use-toast";

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

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      // Create a synthetic event to pass to the handleFileChange function
      const file = e.dataTransfer.files[0];
      
      // Create a new event with the file
      const event = {
        target: {
          files: e.dataTransfer.files
        }
      } as unknown as React.ChangeEvent<HTMLInputElement>;
      
      handleFileChange(event);
    }
  }, [handleFileChange]);

  const handleBrowseClick = () => {
    console.log("Browse button clicked");
    if (fileInputRef.current) {
      console.log("Triggering file input click");
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
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {!selectedFile ? (
        <>
          <UploadCloud className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-medium mb-1">Drag and drop your file</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Or click to browse for a file
          </p>
          <Input
            type="file"
            className="hidden"
            id="file-upload"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".csv,.xlsx,.json,.xml"
          />
          <Label htmlFor="file-upload" className="cursor-pointer">
            <Button 
              variant="outline" 
              type="button"
              onClick={handleBrowseClick}
            >
              <Upload className="h-4 w-4 mr-2" />
              Browse Files
            </Button>
          </Label>
          <p className="text-xs text-muted-foreground mt-2">
            Supported formats: CSV, XLSX, JSON, XML (Max 10MB)
          </p>
        </>
      ) : (
        <div className="space-y-2">
          <FileText className="h-8 w-8 text-primary mx-auto mb-2" />
          <h3 className="font-medium">{selectedFile.name}</h3>
          <p className="text-sm text-muted-foreground">
            {(selectedFile.size / 1024).toFixed(2)} KB
          </p>
          <div className="flex gap-2 justify-center mt-2">
            <Button variant="outline" size="sm" onClick={resetImport}>
              Choose Different File
            </Button>
            <Button 
              size="sm" 
              onClick={processCsvImport} 
              disabled={isProcessing}
            >
              {isProcessing ? 'Processing...' : 'Import Now'}
            </Button>
          </div>
          
          {/* Car list with iCloud connect option */}
          {importedCars.length > 0 && (
            <div className="mt-4 border rounded-md p-4">
              <h4 className="text-sm font-medium mb-2">Imported Vehicles</h4>
              <ul className="space-y-2 text-sm">
                {importedCars.map((car, index) => (
                  <li key={index} className="flex justify-between items-center border-b pb-2">
                    <span>{car.year} {car.make} {car.model}</span>
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={() => handleConnectImages(car)}
                      className="h-8"
                    >
                      {car.icloud_album_link ? (
                        <>
                          <Check className="h-3 w-3 mr-1" />
                          <Cloud className="h-3 w-3" />
                        </>
                      ) : (
                        <>
                          <Cloud className="h-3 w-3 mr-1" />
                          Connect Images
                        </>
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
