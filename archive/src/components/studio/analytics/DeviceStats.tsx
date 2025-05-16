
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Cpu, HardDrive, Wifi } from "lucide-react";
import type { DeviceStatsProps } from "../types/analyticsTypes";

export const DeviceStats = ({
  cpuUsage,
  memoryUsage,
  diskSpace,
  networkSpeed
}: DeviceStatsProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Device Status</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-md bg-blue-100 dark:bg-blue-900">
              <Cpu className="h-5 w-5 text-blue-600 dark:text-blue-300" />
            </div>
            <div>
              <p className="text-sm font-medium">CPU Usage</p>
              <p className="text-2xl font-bold">{cpuUsage}%</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-md bg-purple-100 dark:bg-purple-900">
              <Activity className="h-5 w-5 text-purple-600 dark:text-purple-300" />
            </div>
            <div>
              <p className="text-sm font-medium">Memory</p>
              <p className="text-2xl font-bold">{memoryUsage}%</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-md bg-amber-100 dark:bg-amber-900">
              <HardDrive className="h-5 w-5 text-amber-600 dark:text-amber-300" />
            </div>
            <div>
              <p className="text-sm font-medium">Disk Space</p>
              <p className="text-2xl font-bold">{diskSpace}GB</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-md bg-green-100 dark:bg-green-900">
              <Wifi className="h-5 w-5 text-green-600 dark:text-green-300" />
            </div>
            <div>
              <p className="text-sm font-medium">Network</p>
              <p className="text-2xl font-bold">{networkSpeed}MB/s</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
