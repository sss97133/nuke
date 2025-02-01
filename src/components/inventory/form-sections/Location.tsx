import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface LocationProps {
  building: string;
  floor: string;
  room: string;
  shelf: string;
  bin: string;
  onBuildingChange: (value: string) => void;
  onFloorChange: (value: string) => void;
  onRoomChange: (value: string) => void;
  onShelfChange: (value: string) => void;
  onBinChange: (value: string) => void;
}

export const Location = ({
  building,
  floor,
  room,
  shelf,
  bin,
  onBuildingChange,
  onFloorChange,
  onRoomChange,
  onShelfChange,
  onBinChange,
}: LocationProps) => {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-[#283845]">Location</h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="building">Building</Label>
          <Input
            id="building"
            value={building}
            onChange={(e) => onBuildingChange(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="floor">Floor</Label>
          <Input
            id="floor"
            value={floor}
            onChange={(e) => onFloorChange(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="room">Room</Label>
          <Input
            id="room"
            value={room}
            onChange={(e) => onRoomChange(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="shelf">Shelf</Label>
          <Input
            id="shelf"
            value={shelf}
            onChange={(e) => onShelfChange(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bin">Bin</Label>
          <Input
            id="bin"
            value={bin}
            onChange={(e) => onBinChange(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
};