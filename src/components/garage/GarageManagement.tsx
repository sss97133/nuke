import { GarageList } from "./GarageList";
import { GarageMap } from "./GarageMap";

export const GarageManagement = () => {
  return (
    <div className="space-y-6">
      <GarageMap />
      <GarageList />
    </div>
  );
};