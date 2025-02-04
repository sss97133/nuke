import { ImportGarages } from "./ImportGarages";
import { CreateGarage } from "./CreateGarage";
import { GarageList } from "./GarageList";
import { GarageMap } from "./GarageMap";

export const GarageManagement = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
        <CreateGarage />
        <ImportGarages />
      </div>

      <GarageMap />
      
      <GarageList />
    </div>
  );
};