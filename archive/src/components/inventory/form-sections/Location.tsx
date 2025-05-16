import type { Database } from '../types';
import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  const { data: verifiedLocations, isLoading } = useQuery({
    queryKey: ['verified-locations'],
    queryFn: async () => {
      console.log('🔍 Fetching verified locations...');
      const { data, error } = await supabase
        .from('verified_locations')
        .select('*')
        .eq('status', 'approved');

      if (error) {
        console.error('❌ Error fetching verified locations:', error);
        throw error;
      }

      console.log('✅ Received verified locations:', data);
      return data;
    }
  });

  const uniqueBuildings = [...new Set(verifiedLocations?.map(loc => loc.building) || [])];
  const uniqueFloors = [...new Set(verifiedLocations?.filter(loc => loc.building === building).map(loc => loc.floor) || [])];
  const uniqueRooms = [...new Set(verifiedLocations?.filter(loc => loc.building === building && loc.floor === floor).map(loc => loc.room) || [])];
  const uniqueShelves = [...new Set(verifiedLocations?.filter(loc => 
    loc.building === building && 
    loc.floor === floor && 
    loc.room === room
  ).map(loc => loc.shelf) || [])];
  const uniqueBins = [...new Set(verifiedLocations?.filter(loc => 
    loc.building === building && 
    loc.floor === floor && 
    loc.room === room &&
    loc.shelf === shelf
  ).map(loc => loc.bin) || [])];

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-[#283845]">Location</h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="building">Building</Label>
          {uniqueBuildings.length > 0 ? (
            <Select value={building} onValueChange={onBuildingChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select building" />
              </SelectTrigger>
              <SelectContent>
                {uniqueBuildings.map((b) => (
                  <SelectItem key={b} value={b || ''}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="building"
              value={building}
              onChange={(e) => onBuildingChange(e.target.value)}
              placeholder={isLoading ? "Loading..." : "Enter building"}
            />
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="floor">Floor</Label>
          {uniqueFloors.length > 0 ? (
            <Select value={floor} onValueChange={onFloorChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select floor" />
              </SelectTrigger>
              <SelectContent>
                {uniqueFloors.map((f) => (
                  <SelectItem key={f} value={f || ''}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="floor"
              value={floor}
              onChange={(e) => onFloorChange(e.target.value)}
              placeholder={isLoading ? "Loading..." : "Enter floor"}
            />
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="room">Room</Label>
          {uniqueRooms.length > 0 ? (
            <Select value={room} onValueChange={onRoomChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select room" />
              </SelectTrigger>
              <SelectContent>
                {uniqueRooms.map((r) => (
                  <SelectItem key={r} value={r || ''}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="room"
              value={room}
              onChange={(e) => onRoomChange(e.target.value)}
              placeholder={isLoading ? "Loading..." : "Enter room"}
            />
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="shelf">Shelf</Label>
          {uniqueShelves.length > 0 ? (
            <Select value={shelf} onValueChange={onShelfChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select shelf" />
              </SelectTrigger>
              <SelectContent>
                {uniqueShelves.map((s) => (
                  <SelectItem key={s} value={s || ''}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="shelf"
              value={shelf}
              onChange={(e) => onShelfChange(e.target.value)}
              placeholder={isLoading ? "Loading..." : "Enter shelf"}
            />
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="bin">Bin</Label>
          {uniqueBins.length > 0 ? (
            <Select value={bin} onValueChange={onBinChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select bin" />
              </SelectTrigger>
              <SelectContent>
                {uniqueBins.map((b) => (
                  <SelectItem key={b} value={b || ''}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="bin"
              value={bin}
              onChange={(e) => onBinChange(e.target.value)}
              placeholder={isLoading ? "Loading..." : "Enter bin"}
            />
          )}
        </div>
      </div>
    </div>
  );
};