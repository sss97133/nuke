import React from 'react';
import { Check, Cloud } from 'lucide-react';
import { Button } from "@/components/ui/button";

interface ImportedCar {
  id?: string;
  make: string;
  model: string;
  year: number | string;
  icloud_album_link?: string;
  [key: string]: string | number | undefined;
}

interface ImportedCarsListProps {
  cars: ImportedCar[];
  onConnectImages: (car: ImportedCar) => void;
}

export const ImportedCarsList: React.FC<ImportedCarsListProps> = ({
  cars,
  onConnectImages
}) => {
  if (cars.length === 0) return null;

  return (
    <div className="mt-4 border rounded-md p-4">
      <h4 className="text-sm font-medium mb-2">Imported Vehicles</h4>
      <ul className="space-y-2 text-sm">
        {cars.map((car, index) => (
          <li key={index} className="flex justify-between items-center border-b pb-2">
            <span>{car.year} {car.make} {car.model}</span>
            <Button 
              size="sm" 
              variant="outline" 
              onClick={() => onConnectImages(car)}
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
  );
};
