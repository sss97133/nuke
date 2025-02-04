import { ImportGarages } from "./ImportGarages";
import { CreateGarage } from "./CreateGarage";
import { GarageList } from "./GarageList";

export const GarageManagement = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
        <CreateGarage />
        <ImportGarages />
      </div>

      <GarageList />
    </div>
  );
};