import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileImport } from "./FileImport";
import { WebsiteImport } from "./WebsiteImport";
import { ImportPreview } from "./ImportPreview";
import { Vehicle } from "@/types/inventory";

export const ImportVehicles = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [normalizedVehicles, setNormalizedVehicles] = useState<Vehicle[]>([]);
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  const handleNormalizedData = (vehicles: Vehicle[]) => {
    setNormalizedVehicles(vehicles);
    setIsPreviewMode(true);
  };

  const resetImport = () => {
    setNormalizedVehicles([]);
    setIsPreviewMode(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Import Vehicles</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import Vehicles</DialogTitle>
        </DialogHeader>

        {isPreviewMode ? (
          <ImportPreview 
            vehicles={normalizedVehicles} 
            onBack={resetImport}
            onComplete={() => setIsOpen(false)}
          />
        ) : (
          <Tabs defaultValue="file" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="file">Import from File</TabsTrigger>
              <TabsTrigger value="website">Import from Website</TabsTrigger>
            </TabsList>
            <TabsContent value="file">
              <FileImport onNormalizedData={handleNormalizedData} />
            </TabsContent>
            <TabsContent value="website">
              <WebsiteImport onNormalizedData={handleNormalizedData} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
};