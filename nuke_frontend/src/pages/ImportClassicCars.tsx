import React from 'react';
import { ClassicCarsImporter } from '../components/vehicle/ClassicCarsImporter';
import { useNavigate } from 'react-router-dom';

const ImportClassicCars: React.FC = () => {
  const navigate = useNavigate();

  const handleImportComplete = (vehicleId: string) => {
    // Navigate to the vehicle profile after import
    setTimeout(() => {
      navigate(`/vehicles/${vehicleId}`);
    }, 2000);
  };

  return (
    <div className="container mx-auto py-8">
      <ClassicCarsImporter 
        onImportComplete={handleImportComplete}
      />
    </div>
  );
};

export default ImportClassicCars;

