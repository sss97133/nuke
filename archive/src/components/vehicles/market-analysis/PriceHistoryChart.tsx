
import { Card } from "@/components/ui/card";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { formatCurrency } from "./utils";

interface PriceHistoryChartProps {
  chartData: Array<{
    date: string;
    price: number;
    notes?: string;
  }>;
}

export const PriceHistoryChart = ({ chartData }: PriceHistoryChartProps) => {
  return (
    <Card className="p-6">
      <h4 className="font-mono text-sm font-semibold mb-4">
        Price History
      </h4>
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12 }}
              tickFormatter={(value) => value}
            />
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(value) => formatCurrency(value)}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const data = payload[0].payload;
                return (
                  <div className="rounded-lg border bg-background p-2 shadow-sm">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="font-mono text-sm font-medium">
                        Date:
                      </div>
                      <div className="font-mono text-sm">
                        {data.date}
                      </div>
                      <div className="font-mono text-sm font-medium">
                        Price:
                      </div>
                      <div className="font-mono text-sm">
                        {formatCurrency(data.price)}
                      </div>
                      {data.notes && (
                        <>
                          <div className="font-mono text-sm font-medium">
                            Notes:
                          </div>
                          <div className="font-mono text-sm">
                            {data.notes}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              }}
            />
            <Line
              type="monotone"
              dataKey="price"
              stroke="#283845"
              strokeWidth={2}
              dot={{ fill: "#283845" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
};
