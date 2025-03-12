import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { RefreshCw, Wifi, Clock, AlertTriangle } from "lucide-react";
import { LineChart, BarChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface AlertItem {
  id: string;
  message: string;
  timestamp: string;
  severity: "low" | "medium" | "high";
}

const CloudMonitoring = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [performanceData, setPerformanceData] = useState<{ time: string; value: number }[]>([]);
  const [connectionHistory, setConnectionHistory] = useState<{ hour: string; value: number }[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [cicdStatus, setCicdStatus] = useState<{
    status: 'success' | 'warning' | 'error';
    message: string;
    lastBuild: string;
  }>({
    status: 'success',
    message: 'All systems operational',
    lastBuild: new Date().toISOString()
  });

  // Generate mock data on component mount
  useEffect(() => {
    const loadData = () => {
      setIsLoading(true);
      
      // Monitor CI/CD health
      fetch('https://api.github.com/repos/sss97133/nuke/actions/runs')
        .then(res => res.json())
        .then(data => {
          const lastRun = data.workflow_runs?.[0];
          if (lastRun) {
            setCicdStatus({
              status: lastRun.conclusion === 'success' ? 'success' : 'warning',
              message: lastRun.conclusion === 'success' ? 'All systems operational' : 'Recent build issues detected',
              lastBuild: lastRun.updated_at
            });
          }
        })
        .catch(err => {
          console.error('Error fetching CI/CD status:', err);
          setCicdStatus(prev => ({
            ...prev,
            status: 'error',
            message: 'Unable to fetch build status'
          }));
        });

      // Simulate API call delay
      setTimeout(() => {
        // Generate performance data points (response times in ms)
        const newPerformanceData = Array.from({ length: 24 }, (_, i) => ({
          time: `${i}:00`,
          value: Math.floor(Math.random() * 150) + 50
        }));
        
        // Generate connection stability (percentage)
        const newConnectionHistory = Array.from({ length: 12 }, (_, i) => ({
          hour: `${i * 2}:00`,
          value: Math.min(100, Math.max(60, Math.floor(Math.random() * 40) + 60))
        }));
        
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
    const interval = setInterval(loadData, 300000); // Check every 5 minutes
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    // Re-fetch data
    setIsLoading(true);
    
    setTimeout(() => {
      // Update performance data with new random values
      setPerformanceData(prev => 
        prev.map(item => ({
          ...item,
          value: Math.max(50, Math.min(200, item.value + Math.floor(Math.random() * 40) - 20))
        }))
      );
      
      // Update connection history
      setConnectionHistory(prev => 
        prev.map(item => ({
          ...item,
          value: Math.min(100, Math.max(60, item.value + Math.floor(Math.random() * 10) - 5))
        }))
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
        <Badge variant={cicdStatus.status === 'success' ? 'default' : 'destructive'}>
          CI/CD: {cicdStatus.message}
        </Badge>
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
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={performanceData}
                  margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="value" stroke="#3b82f6" activeDot={{ r: 8 }} />
                </LineChart>
              </ResponsiveContainer>
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
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={connectionHistory}
                  margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="hour" />
                  <YAxis />
                  <Tooltip formatter={(value: number) => [`${value}%`, 'Value']} />
                  <Bar dataKey="value" fill="#22c55e" />
                </BarChart>
              </ResponsiveContainer>
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
