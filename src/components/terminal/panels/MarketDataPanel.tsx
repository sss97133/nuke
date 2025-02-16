import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
const mockData = [{
  time: '09:30',
  value: 100
}, {
  time: '10:00',
  value: 105
}, {
  time: '10:30',
  value: 102
}, {
  time: '11:00',
  value: 108
}, {
  time: '11:30',
  value: 106
}, {
  time: '12:00',
  value: 110
}];
export const MarketDataPanel = () => {
  return <ScrollArea className="h-[calc(85vh-2.5rem)] p-4">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <Card className="p-2 bg-gray-400 hover:bg-gray-300">
            <div className="text-xs font-mono">SCRAP/USD</div>
            <div className="text-lg font-mono text-green-500">$110.45</div>
            <div className="text-xs text-green-500">+2.3%</div>
          </Card>
          <Card className="p-2 bg-gray-400 hover:bg-gray-300">
            <div className="text-xs font-mono">24h Volume</div>
            <div className="text-lg font-mono">$1.2M</div>
            <div className="text-xs text-muted-foreground">+125K</div>
          </Card>
        </div>

        <Card className="p-4 h-48 bg-gray-400 hover:bg-gray-300">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mockData}>
              <XAxis dataKey="time" stroke="#666" />
              <YAxis stroke="#666" />
              <Tooltip contentStyle={{
              backgroundColor: '#1f2937',
              border: 'none'
            }} />
              <Line type="monotone" dataKey="value" stroke="#22c55e" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <div className="space-y-2">
          <h3 className="text-sm font-mono">Market Statistics</h3>
          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div>Market Cap:</div>
            <div>$125.4M</div>
            <div>Circulating Supply:</div>
            <div>1.2M NUKE</div>
            <div>Total Supply:</div>
            <div>2.0M NUKE</div>
            <div>Max Supply:</div>
            <div>5.0M NUKE</div>
          </div>
        </div>
      </div>
    </ScrollArea>;
};