
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";

export const TokenAnalyticsPanel = () => {
  return <ScrollArea className="h-[calc(85vh-2.5rem)] p-4">
      <div className="space-y-4">
        <Card className="p-4 bg-gray-400 hover:bg-gray-300">
          <h3 className="text-sm font-mono mb-2">Token Distribution</h3>
          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between">
              <span>Team Allocation:</span>
              <span>20%</span>
            </div>
            <div className="flex justify-between">
              <span>Public Sale:</span>
              <span>40%</span>
            </div>
            <div className="flex justify-between">
              <span>Treasury:</span>
              <span>25%</span>
            </div>
            <div className="flex justify-between">
              <span>Ecosystem:</span>
              <span>15%</span>
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-gray-500 hover:bg-gray-400">
          <h3 className="text-sm font-mono mb-2">Holder Analysis</h3>
          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between">
              <span>Total Holders:</span>
              <span>1,234</span>
            </div>
            <div className="flex justify-between">
              <span>Active Wallets (24h):</span>
              <span>456</span>
            </div>
            <div className="flex justify-between">
              <span>New Holders (24h):</span>
              <span>+23</span>
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-gray-600 hover:bg-gray-500">
          <h3 className="text-sm font-mono mb-2">Top Holders</h3>
          <div className="space-y-2 text-xs font-mono">
            {[1, 2, 3, 4, 5].map(i => <div key={i} className="flex justify-between">
                <span>0x...{i}abc</span>
                <span>{6 - i}%</span>
              </div>)}
          </div>
        </Card>
      </div>
    </ScrollArea>;
};

export { TokenAnalyticsPanel as TokenAnalytics };
