
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Server, Wifi } from "lucide-react";

interface SystemMetrics {
  connectionStatus: 'ACTIVE' | 'INACTIVE';
  latency: number;
  uptime: number;
  cpu: number;
  memory: number;
  temperature: number;
}

const SystemStatus = () => {
  const [metrics, setMetrics] = useState<SystemMetrics>({
    connectionStatus: 'INACTIVE',
    latency: 0,
    uptime: 0,
    cpu: 45,
    memory: 32,
    temperature: 58
  });

  useEffect(() => {
    const updateMetrics = async () => {
      try {
        // This would normally fetch from an API
        // For demonstration, we'll simulate live data
        setMetrics(prev => ({
          ...prev,
          connectionStatus: Math.random() > 0.2 ? 'ACTIVE' : 'INACTIVE',
          latency: Math.floor(Math.random() * 120) + 20,
          uptime: Math.min(prev.uptime + 0.1, 99.99),
          cpu: Math.floor(Math.random() * 30) + 30,
          memory: Math.floor(Math.random() * 20) + 25,
          temperature: Math.floor(Math.random() * 15) + 50
        }));
      } catch (error) {
        console.error("Error fetching system metrics:", error);
      }
    };

    // Initial update
    updateMetrics();

    // Update metrics every 5 seconds
    const interval = setInterval(updateMetrics, 5000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center">
            <Wifi className="h-4 w-4 mr-2" />
            Connection Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-sm">Status:</span>
              <span className={metrics.connectionStatus === 'ACTIVE' ? 'text-green-500' : 'text-red-500'}>
                {metrics.connectionStatus}
              </span>
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-muted-foreground text-sm">Latency:</span>
              <span>{metrics.latency} ms</span>
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-muted-foreground text-sm">Uptime:</span>
              <span>{metrics.uptime.toFixed(2)}%</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center">
            <Server className="h-4 w-4 mr-2" />
            System Resources
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-sm">CPU Usage:</span>
              <span>{metrics.cpu}%</span>
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-muted-foreground text-sm">Memory:</span>
              <span>{metrics.memory}%</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center">
            <Activity className="h-4 w-4 mr-2" />
            Device Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-sm">Temperature:</span>
              <span>{metrics.temperature}°C</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SystemStatus;
