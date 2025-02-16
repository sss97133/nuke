import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ChartBar, ChartLine, Database, DollarSign, Monitor } from "lucide-react";
import { MarketDataPanel } from "./panels/MarketDataPanel";
import { TokenAnalyticsPanel } from "./panels/TokenAnalyticsPanel";
import { NewsPanel } from "./panels/NewsPanel";
import { OrderBookPanel } from "./panels/OrderBookPanel";
export const BloombergTerminal = () => {
  const [layout, setLayout] = useState([30, 40, 30]);
  return <div className="h-[90vh] bg-background text-foreground p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Monitor className="w-5 h-5" />
          <h2 className="text-lg font-mono">SCRAP Terminal</h2>
        </div>
        <div className="flex gap-2">
          <DollarSign className="w-5 h-5" />
          <Database className="w-5 h-5" />
          <ChartLine className="w-5 h-5" />
          <ChartBar className="w-5 h-5" />
        </div>
      </div>

      <ResizablePanelGroup direction="horizontal" className="min-h-[85vh]">
        <ResizablePanel defaultSize={layout[0]}>
          <Card className="h-full bg-card border-border">
            <Tabs defaultValue="market" className="w-full">
              <TabsList className="w-full bg-muted">
                <TabsTrigger value="market">Market Data</TabsTrigger>
                <TabsTrigger value="tokens">Token Analytics</TabsTrigger>
              </TabsList>
              <TabsContent value="market">
                <MarketDataPanel />
              </TabsContent>
              <TabsContent value="tokens">
                <TokenAnalyticsPanel />
              </TabsContent>
            </Tabs>
          </Card>
        </ResizablePanel>

        <ResizableHandle className="bg-border" />

        <ResizablePanel defaultSize={layout[1]}>
          <Card className="h-full bg-card border-border">
            <OrderBookPanel />
          </Card>
        </ResizablePanel>

        <ResizableHandle className="bg-border" />

        <ResizablePanel defaultSize={layout[2]}>
          <Card className="h-full bg-card border-border">
            <NewsPanel />
          </Card>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>;
};