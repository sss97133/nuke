import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Car, Package, Wrench, Users, Activity, 
  Calendar, Video, Award, TrendingUp 
} from "lucide-react";

export const Home = () => {
  return (
    <div className="space-y-6 p-6 pb-16">
      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Car className="h-4 w-4" />
            <h3 className="text-sm font-medium">Total Vehicles</h3>
          </div>
          <p className="mt-2 text-2xl font-bold">24</p>
          <p className="text-xs text-muted-foreground">+2 this month</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            <h3 className="text-sm font-medium">Inventory Items</h3>
          </div>
          <p className="mt-2 text-2xl font-bold">156</p>
          <p className="text-xs text-muted-foreground">12 need attention</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4" />
            <h3 className="text-sm font-medium">Active Services</h3>
          </div>
          <p className="mt-2 text-2xl font-bold">8</p>
          <p className="text-xs text-muted-foreground">3 due today</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <h3 className="text-sm font-medium">Team Members</h3>
          </div>
          <p className="mt-2 text-2xl font-bold">12</p>
          <p className="text-xs text-muted-foreground">2 online now</p>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Button variant="outline" className="h-24 flex flex-col gap-2">
            <Car className="h-6 w-6" />
            Add Vehicle
          </Button>
          <Button variant="outline" className="h-24 flex flex-col gap-2">
            <Package className="h-6 w-6" />
            New Inventory
          </Button>
          <Button variant="outline" className="h-24 flex flex-col gap-2">
            <Wrench className="h-6 w-6" />
            Create Service
          </Button>
          <Button variant="outline" className="h-24 flex flex-col gap-2">
            <Video className="h-6 w-6" />
            Start Stream
          </Button>
        </div>
      </Card>

      {/* Recent Activity & Upcoming */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Activity className="h-4 w-4" />
              <div>
                <p className="text-sm">New vehicle added: 2023 Toyota Camry</p>
                <p className="text-xs text-muted-foreground">2 hours ago</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Award className="h-4 w-4" />
              <div>
                <p className="text-sm">Achievement unlocked: Master Mechanic</p>
                <p className="text-xs text-muted-foreground">5 hours ago</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <TrendingUp className="h-4 w-4" />
              <div>
                <p className="text-sm">Market analysis completed</p>
                <p className="text-xs text-muted-foreground">Yesterday</p>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Upcoming</h2>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Calendar className="h-4 w-4" />
              <div>
                <p className="text-sm">Vehicle Service: BMW M3</p>
                <p className="text-xs text-muted-foreground">Tomorrow, 10:00 AM</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Video className="h-4 w-4" />
              <div>
                <p className="text-sm">Live Stream: Workshop Tour</p>
                <p className="text-xs text-muted-foreground">Friday, 2:00 PM</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Package className="h-4 w-4" />
              <div>
                <p className="text-sm">Inventory Check Due</p>
                <p className="text-xs text-muted-foreground">Next Week</p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};