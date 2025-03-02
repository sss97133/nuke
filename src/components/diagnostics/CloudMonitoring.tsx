
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AreaChart, BarChart } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { RefreshCw, Wifi, Clock, AlertTriangle } from "lucide-react";

interface AlertItem {
  id: string;
  message: string;
  timestamp: string;
  severity: "low" | "medium" | "high";
}

const CloudMonitoring = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [performanceData, setPerformanceData] = useState<number[]>([]);
  const [connectionHistory, setConnectionHistory] = useState<number[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  // Generate mock data on component mount
  useEffect(() => {
    const loadData = () => {
      setIsLoading(true);
      
      // Simulate API call delay
      setTimeout(() => {
        // Generate performance data points (response times in ms)
        const newPerformanceData = Array.from({ length: 24 }, () => 
          Math.floor(Math.random() * 150) + 50
        );
        
        // Generate connection stability (percentage)
        const newConnectionHistory = Array.from({ length: 12 }, () => 
          Math.min(100, Math.max(60, Math.floor(Math.random() * 40) + 60))
        );
        
        // Generate alerts
        const newAlerts: AlertItem[] = [
          {
            id: "1",
            message: "Vehicle offline for more than 30 minutes",
            timestamp: new Date(Date.now() - 1800000).toISOString(),
            severity: "medium"
          },
          {
            id: "2",
            message: "Battery voltage below recommended level",
            timestamp: new Date(Date.now() - 7200000).toISOString(),
            severity: "high"
          },
          {
            id: "3",
            message: "Connection latency increased",
            timestamp: new Date(Date.now() - 3600000).toISOString(),
            severity: "low"
          }
        ];
        
        setPerformanceData(newPerformanceData);
        setConnectionHistory(newConnectionHistory);
        setAlerts(newAlerts);
        setLastUpdated(new Date());
        setIsLoading(false);
      }, 1500);
    };
    
    loadData();
  }, []);

  const handleRefresh = () => {
    // Re-fetch data
    setIsLoading(true);
    
    setTimeout(() => {
      // Update performance data with new random values
      setPerformanceData(prev => 
        prev.map(value => Math.max(50, Math.min(200, value + Math.floor(Math.random() * 40) - 20)))
      );
      
      // Update connection history
      setConnectionHistory(prev => 
        prev.map(value => Math.min(100, Math.max(60, value + Math.floor(Math.random() * 10) - 5)))
      );
      
      setLastUpdated(new Date());
      setIsLoading(false);
    }, 1000);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-medium">Cloud Monitoring Status</h3>
          <p className="text-sm text-muted-foreground flex items-center mt-1">
            <Clock className="h-3 w-3 mr-1" />
            Last updated: {lastUpdated.toLocaleTimeString()}
          </p>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={handleRefresh} 
          disabled={isLoading}
          className="flex items-center"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Response Time (24h)</CardTitle>
            <CardDescription>Average API response time in milliseconds</CardDescription>
          </CardHeader>
          <CardContent className="h-[200px]">
            {!isLoading && (
              <AreaChart 
                data={performanceData.map((value, index) => ({ 
                  time: `${index}:00`, 
                  value 
                }))}
                index="time"
                categories={["value"]}
                colors={["blue"]}
                yAxisWidth={40}
                showLegend={false}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connection Stability</CardTitle>
            <CardDescription>Percentage of successful connections (12h)</CardDescription>
          </CardHeader>
          <CardContent className="h-[200px]">
            {!isLoading && (
              <BarChart 
                data={connectionHistory.map((value, index) => ({ 
                  hour: `${index * 2}:00`, 
                  value 
                }))}
                index="hour"
                categories={["value"]}
                colors={["green"]}
                yAxisWidth={40}
                valueFormatter={(value) => `${value}%`}
                showLegend={false}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2 text-orange-500" />
            Recent Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">No recent alerts</p>
          ) : (
            <div className="space-y-3">
              {alerts.map(alert => (
                <div key={alert.id} className="flex items-start justify-between border-b pb-3">
                  <div>
                    <p className="font-medium">{alert.message}</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(alert.timestamp).toLocaleString()}
                    </p>
                  </div>
                  <Badge variant={
                    alert.severity === "high" ? "destructive" : 
                    alert.severity === "medium" ? "default" : 
                    "outline"
                  }>
                    {alert.severity}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CloudMonitoring;
