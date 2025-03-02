
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Gauge, AlertTriangle } from "lucide-react";

interface SensorData {
  name: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  isWarning: boolean;
}

const OBDIIDataLogger = () => {
  const [sensorData, setSensorData] = useState<Record<string, SensorData[]>>({
    engine: [
      { name: "RPM", value: 0, unit: "rpm", min: 0, max: 8000, isWarning: false },
      { name: "Temperature", value: 0, unit: "°C", min: 0, max: 120, isWarning: false },
      { name: "Oil Pressure", value: 0, unit: "psi", min: 0, max: 100, isWarning: false },
      { name: "MAP", value: 0, unit: "kPa", min: 0, max: 200, isWarning: false },
    ],
    emissions: [
      { name: "O2", value: 0, unit: "V", min: 0, max: 1, isWarning: false },
      { name: "CO2", value: 0, unit: "g/km", min: 0, max: 200, isWarning: false },
      { name: "NOx", value: 0, unit: "ppm", min: 0, max: 1000, isWarning: false },
    ],
    performance: [
      { name: "Throttle", value: 0, unit: "%", min: 0, max: 100, isWarning: false },
      { name: "Intake Air", value: 0, unit: "g/s", min: 0, max: 100, isWarning: false },
      { name: "Fuel Pressure", value: 0, unit: "kPa", min: 0, max: 500, isWarning: false },
    ]
  });
  
  const [connected, setConnected] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    // Simulate OBD-II connection
    const timer = setTimeout(() => {
      setConnected(true);
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!connected) return;

    // Simulate live data from OBD-II
    const interval = setInterval(() => {
      const newWarnings: string[] = [];
      
      setSensorData(prev => {
        const newData = { ...prev };
        
        Object.keys(newData).forEach(category => {
          newData[category] = newData[category].map(sensor => {
            // Generate realistic but random values
            let newValue: number;
            
            if (sensor.name === "RPM") {
              newValue = Math.floor(Math.random() * 2000) + 800;
            } else if (sensor.name === "Temperature") {
              newValue = Math.floor(Math.random() * 30) + 80;
              if (newValue > 110) {
                newWarnings.push("Engine temperature too high");
              }
            } else if (sensor.name === "O2") {
              newValue = Math.random() * 0.5 + 0.2;
            } else {
              // Random value between 30% and 70% of max for other sensors
              newValue = sensor.max * (0.3 + Math.random() * 0.4);
            }
            
            const isWarning = newValue > sensor.max * 0.85;
            if (isWarning && !sensor.isWarning) {
              newWarnings.push(`${sensor.name} is approaching critical level`);
            }
            
            return { ...sensor, value: newValue, isWarning };
          });
        });
        
        return newData;
      });
      
      if (newWarnings.length > 0) {
        setWarnings(prev => [...prev, ...newWarnings]);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [connected]);

  if (!connected) {
    return (
      <Card className="w-full">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center space-y-4">
            <Gauge className="h-10 w-10 text-muted-foreground animate-pulse" />
            <p>Connecting to OBD-II interface...</p>
            <Progress value={45} className="w-[60%]" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {warnings.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {warnings[warnings.length - 1]}
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="engine">
        <TabsList className="grid grid-cols-3 mb-4">
          <TabsTrigger value="engine">Engine</TabsTrigger>
          <TabsTrigger value="emissions">Emissions</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        {Object.keys(sensorData).map((category) => (
          <TabsContent key={category} value={category} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sensorData[category].map((sensor) => (
                <Card key={sensor.name}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      {sensor.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <span className={sensor.isWarning ? 'text-orange-500 font-bold' : ''}>
                        {sensor.value.toFixed(1)} {sensor.unit}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Range: {sensor.min}-{sensor.max} {sensor.unit}
                      </span>
                    </div>
                    <Progress 
                      value={(sensor.value / sensor.max) * 100} 
                      className={`mt-2 ${sensor.isWarning ? 'bg-orange-200' : ''}`} 
                    />
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};

export default OBDIIDataLogger;
