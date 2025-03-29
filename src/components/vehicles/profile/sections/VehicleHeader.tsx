import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Store,
  Gavel,
  Video,
  Radio,
  Coins,
  Share2,
  MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Database } from "@/types/database"; // Import Database type

interface VehicleHeaderProps {
  vehicle: Database["public"]["Tables"]["vehicles"]["Row"];
  isOwner: boolean;
  activeFeatures: {
    marketplace: boolean;
    auction: boolean;
    livestream: boolean;
    liveData: boolean;
    investment: boolean;
  };
  onToggleFeature: (feature: string) => void;
}

export const VehicleHeader = ({
  vehicle,
  isOwner,
  activeFeatures,
  onToggleFeature,
}: VehicleHeaderProps) => {
  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  return (
    <Card>
      <CardHeader className="space-y-1">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-2xl md:text-3xl">
              {vehicle.year} {vehicle.make} {vehicle.model}
              {vehicle.trim && ` ${vehicle.trim}`}
            </CardTitle>
            <CardDescription>
              Added {formatDate(vehicle.created_at)} • VIN: {vehicle.vin}
            </CardDescription>
          </div>
          
          <div className="flex gap-2">
            <Button variant="outline" size="icon">
              <Share2 className="h-4 w-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem>Edit Details</DropdownMenuItem>
                <DropdownMenuItem>Manage Access</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-red-600">
                  Report Issue
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {/* Basic Stats */}
          <div>
            <span className="text-sm text-muted-foreground">Mileage</span>
            <p className="font-medium">{vehicle.mileage?.toLocaleString() || 'N/A'}</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Engine</span>
            <p className="font-medium">{vehicle.engine_type || 'N/A'}</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Color</span>
            <p className="font-medium">{vehicle.color || 'N/A'}</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Location</span>
            <p className="font-medium">{vehicle.location || 'N/A'}</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Status</span>
            <p className="font-medium">{vehicle.status || 'N/A'}</p>
          </div>
        </div>

        {isOwner && (
          <div className="mt-6 border-t pt-6">
            <h3 className="text-sm font-medium mb-4">Feature Toggles</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Store className="h-4 w-4" />
                  <span className="text-sm">Marketplace</span>
                </div>
                <Switch
                  checked={activeFeatures.marketplace}
                  onCheckedChange={() => onToggleFeature('marketplace')}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Gavel className="h-4 w-4" />
                  <span className="text-sm">Auction</span>
                </div>
                <Switch
                  checked={activeFeatures.auction}
                  onCheckedChange={() => onToggleFeature('auction')}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Video className="h-4 w-4" />
                  <span className="text-sm">Livestream</span>
                </div>
                <Switch
                  checked={activeFeatures.livestream}
                  onCheckedChange={() => onToggleFeature('livestream')}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Radio className="h-4 w-4" />
                  <span className="text-sm">Live Data</span>
                </div>
                <Switch
                  checked={activeFeatures.liveData}
                  onCheckedChange={() => onToggleFeature('liveData')}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Coins className="h-4 w-4" />
                  <span className="text-sm">Investment</span>
                </div>
                <Switch
                  checked={activeFeatures.investment}
                  onCheckedChange={() => onToggleFeature('investment')}
                />
              </div>
            </div>
          </div>
        )}

        {/* Active Feature Badges */}
        <div className="mt-6 flex flex-wrap gap-2">
          {activeFeatures.marketplace && (
            <Badge variant="secondary">
              <Store className="h-3 w-3 mr-1" />
              For Sale
            </Badge>
          )}
          {activeFeatures.auction && (
            <Badge variant="secondary">
              <Gavel className="h-3 w-3 mr-1" />
              Auction
            </Badge>
          )}
          {activeFeatures.livestream && (
            <Badge variant="secondary">
              <Video className="h-3 w-3 mr-1" />
              Live
            </Badge>
          )}
          {activeFeatures.liveData && (
            <Badge variant="secondary">
              <Radio className="h-3 w-3 mr-1" />
              Connected
            </Badge>
          )}
          {activeFeatures.investment && (
            <Badge variant="secondary">
              <Coins className="h-3 w-3 mr-1" />
              Investment
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}; 