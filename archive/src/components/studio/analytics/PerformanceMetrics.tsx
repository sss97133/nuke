
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import type { PerformanceMetricProps } from "../types/analyticsTypes";

const PerformanceMetric = ({ title, current, previous, unit, change }: PerformanceMetricProps) => {
  const isPositive = change ? change > 0 : false;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{title}</span>
        {change !== undefined && (
          <span className={`text-xs flex items-center ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
            {isPositive ? <ArrowUpIcon className="h-3 w-3 mr-0.5" /> : <ArrowDownIcon className="h-3 w-3 mr-0.5" />}
            {Math.abs(change)}%
          </span>
        )}
      </div>
      <Progress value={current} className="h-2" />
      <div className="flex justify-between text-xs text-muted-foreground">
        <div>{current}{unit}</div>
        {previous !== undefined && (
          <div>Previous: {previous}{unit}</div>
        )}
      </div>
    </div>
  );
};

export const PerformanceMetrics = () => {
  const metrics = [
    { title: "CPU Usage", current: 45, previous: 38, unit: "%", change: 18.4 },
    { title: "Memory Usage", current: 68, previous: 72, unit: "%", change: -5.6 },
    { title: "Disk Usage", current: 32, previous: 30, unit: "%", change: 6.7 },
    { title: "Network Usage", current: 78, previous: 65, unit: "%", change: 20.0 },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>System Performance</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {metrics.map((metric, index) => (
            <PerformanceMetric
              key={index}
              title={metric.title}
              current={metric.current}
              previous={metric.previous}
              unit={metric.unit}
              change={metric.change}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
