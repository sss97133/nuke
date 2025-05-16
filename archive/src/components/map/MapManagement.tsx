import { LocationsList } from "./LocationsList";
import { MapView } from "./MapView";

export const MapManagement = () => {
  return (
    <div className="space-y-6">
      <MapView />
      <LocationsList />
    </div>
  );
};