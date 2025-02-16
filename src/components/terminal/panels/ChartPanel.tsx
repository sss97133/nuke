
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const mockData = [
  { time: '09:30', value: 100, volume: 1200 },
  { time: '10:00', value: 105, volume: 1500 },
  { time: '10:30', value: 102, volume: 1100 },
  { time: '11:00', value: 108, volume: 1800 },
  { time: '11:30', value: 106, volume: 1300 },
  { time: '12:00', value: 110, volume: 1600 },
  { time: '12:30', value: 112, volume: 1400 },
  { time: '13:00', value: 115, volume: 1900 },
  { time: '13:30', value: 113, volume: 1700 },
  { time: '14:00', value: 118, volume: 2100 }
];

export const ChartPanel = () => {
  return (
    <ScrollArea className="h-[calc(85vh-2.5rem)] p-4">
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-mono">SCRAP/USD Chart</h3>
          <div className="flex gap-2">
            <Select defaultValue="1D">
              <SelectTrigger className="w-20">
                <SelectValue placeholder="Timeframe" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1H">1H</SelectItem>
                <SelectItem value="4H">4H</SelectItem>
                <SelectItem value="1D">1D</SelectItem>
                <SelectItem value="1W">1W</SelectItem>
                <SelectItem value="1M">1M</SelectItem>
              </SelectContent>
            </Select>
            <Select defaultValue="line">
              <SelectTrigger className="w-24">
                <SelectValue placeholder="Chart Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="line">Line</SelectItem>
                <SelectItem value="candle">Candlestick</SelectItem>
                <SelectItem value="area">Area</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card className="p-4 bg-gray-400 hover:bg-gray-300">
          <div className="h-[60vh]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={mockData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#666" />
                <XAxis dataKey="time" stroke="#666" />
                <YAxis yAxisId="price" stroke="#666" />
                <YAxis 
                  yAxisId="volume" 
                  orientation="right" 
                  stroke="#60a5fa"
                />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: '#1f2937',
                    border: 'none'
                  }}
                  formatter={(value, name) => [
                    name === 'Price' ? `$${value}` : value,
                    name
                  ]}
                />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="value" 
                  stroke="#22c55e" 
                  strokeWidth={2} 
                  dot={false} 
                  name="Price"
                  yAxisId="price"
                />
                <Line 
                  type="monotone" 
                  dataKey="volume" 
                  stroke="#60a5fa" 
                  strokeWidth={1} 
                  dot={false} 
                  name="Volume"
                  yAxisId="volume"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div className="grid grid-cols-3 gap-2">
          <Card className="p-2 bg-gray-400 hover:bg-gray-300">
            <div className="text-xs font-mono">24h High</div>
            <div className="text-lg font-mono">$118.00</div>
          </Card>
          <Card className="p-2 bg-gray-400 hover:bg-gray-300">
            <div className="text-xs font-mono">24h Low</div>
            <div className="text-lg font-mono">$100.00</div>
          </Card>
          <Card className="p-2 bg-gray-400 hover:bg-gray-300">
            <div className="text-xs font-mono">24h Change</div>
            <div className="text-lg font-mono text-green-500">+18.00%</div>
          </Card>
        </div>
      </div>
    </ScrollArea>
  );
};

