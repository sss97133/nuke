
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { AnalyticsChartProps } from "../types/analyticsTypes";

export const UsageChart = ({ data, title, description }: AnalyticsChartProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={{
            recording: {
              label: "Recording",
              theme: {
                light: "hsl(221.2 83.2% 53.3%)",
                dark: "hsl(217.2 91.2% 59.8%)"
              }
            },
            streaming: {
              label: "Streaming",
              theme: {
                light: "hsl(142.1 70.6% 45.3%)",
                dark: "hsl(142.1 76.2% 36.3%)"
              }
            }
          }}
          className="aspect-[4/3]"
        >
          <BarChart data={data}>
            <XAxis 
              dataKey="name" 
              stroke="#888888" 
              fontSize={12} 
              tickLine={false} 
              axisLine={false} 
            />
            <YAxis
              stroke="#888888"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `${value}min`}
            />
            <Tooltip 
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="rounded-lg border bg-background p-2 shadow-sm">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col">
                          <span className="text-[0.70rem] uppercase text-muted-foreground">
                            Recording
                          </span>
                          <span className="font-bold text-xs">
                            {payload[0].value} min
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[0.70rem] uppercase text-muted-foreground">
                            Streaming
                          </span>
                          <span className="font-bold text-xs">
                            {payload[1].value} min
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Bar 
              dataKey="recording" 
              fill="var(--color-recording)" 
              radius={[4, 4, 0, 0]}
            />
            <Bar 
              dataKey="streaming" 
              fill="var(--color-streaming)" 
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
};
