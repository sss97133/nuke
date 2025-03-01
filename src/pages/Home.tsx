
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MarketDataPanel } from "@/components/terminal/panels/MarketDataPanel";
import { OrderBookPanel } from "@/components/terminal/panels/OrderBookPanel";
import { NewsPanel } from "@/components/terminal/panels/NewsPanel";
import { TokenAnalyticsPanel } from "@/components/terminal/panels/TokenAnalyticsPanel";
import { ChartPanel } from "@/components/terminal/panels/ChartPanel";
import { Monitor, DollarSign, Database, ChartLine, ChartBar, Car, Video } from "lucide-react";

const Home = () => {
  const [layout, setLayout] = React.useState([30, 40, 30]);

  return (
    <div className="container max-w-full px-0 py-2 h-[calc(100vh-64px)]">
      <div className="flex items-center justify-between mb-2 px-4">
        <div className="flex items-center gap-2">
          <Monitor className="w-5 h-5" />
          <h2 className="text-lg font-mono">Vehicle Discovery Terminal</h2>
        </div>
        <div className="flex gap-2">
          <DollarSign className="w-5 h-5" />
          <Database className="w-5 h-5" />
          <ChartLine className="w-5 h-5" />
          <ChartBar className="w-5 h-5" />
          <Car className="w-5 h-5" />
          <Video className="w-5 h-5" />
        </div>
      </div>

      <ResizablePanelGroup direction="horizontal" className="min-h-[calc(100vh-100px)]">
        <ResizablePanel defaultSize={layout[0]}>
          <Card className="h-full bg-card border-border rounded-none">
            <Tabs defaultValue="market" className="w-full">
              <TabsList className="w-full bg-muted">
                <TabsTrigger value="market">Market Data</TabsTrigger>
                <TabsTrigger value="tokens">Token Analytics</TabsTrigger>
                <TabsTrigger value="auctions">Auctions</TabsTrigger>
              </TabsList>
              <TabsContent value="market" className="h-[calc(100vh-140px)] overflow-auto">
                <MarketDataPanel />
              </TabsContent>
              <TabsContent value="tokens" className="h-[calc(100vh-140px)] overflow-auto">
                <TokenAnalyticsPanel />
              </TabsContent>
              <TabsContent value="auctions" className="h-[calc(100vh-140px)] overflow-auto">
                <div className="p-4">
                  <h3 className="text-lg font-semibold mb-3">Featured Auctions</h3>
                  <div className="grid gap-4">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="flex border rounded p-3 hover:bg-accent cursor-pointer">
                        <div className="w-24 h-16 bg-muted rounded flex-shrink-0 mr-3"></div>
                        <div>
                          <div className="font-medium">Porsche 911 Turbo {1990 + i}</div>
                          <div className="text-sm text-muted-foreground">Current bid: $78,{i}00</div>
                          <div className="text-xs text-muted-foreground">Ends in {i} days</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </Card>
        </ResizablePanel>

        <ResizableHandle className="bg-border" />

        <ResizablePanel defaultSize={layout[1]}>
          <Card className="h-full bg-card border-border rounded-none">
            <Tabs defaultValue="chart" className="w-full">
              <TabsList className="w-full bg-muted">
                <TabsTrigger value="chart">Price Charts</TabsTrigger>
                <TabsTrigger value="orderbook">Order Book</TabsTrigger>
                <TabsTrigger value="streaming">Live Streams</TabsTrigger>
              </TabsList>
              <TabsContent value="chart" className="h-[calc(100vh-140px)] overflow-auto">
                <ChartPanel />
              </TabsContent>
              <TabsContent value="orderbook" className="h-[calc(100vh-140px)] overflow-auto">
                <OrderBookPanel />
              </TabsContent>
              <TabsContent value="streaming" className="h-[calc(100vh-140px)] overflow-auto">
                <div className="p-4">
                  <h3 className="text-lg font-semibold mb-3">Live Auctions & Events</h3>
                  <div className="grid gap-4">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="border rounded overflow-hidden">
                        <div className="h-32 bg-muted w-full flex items-center justify-center">
                          <Video className="w-8 h-8 text-muted-foreground" />
                        </div>
                        <div className="p-3">
                          <div className="font-medium">Live Auction: Rare Classic {i}</div>
                          <div className="text-sm text-muted-foreground">Viewers: {i * 142}</div>
                          <div className="flex items-center mt-2">
                            <div className="w-6 h-6 bg-accent rounded-full mr-2"></div>
                            <span className="text-sm">MotorExpert{i}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </Card>
        </ResizablePanel>

        <ResizableHandle className="bg-border" />

        <ResizablePanel defaultSize={layout[2]}>
          <Card className="h-full bg-card border-border rounded-none">
            <Tabs defaultValue="news" className="w-full">
              <TabsList className="w-full bg-muted">
                <TabsTrigger value="news">News Feed</TabsTrigger>
                <TabsTrigger value="social">Social</TabsTrigger>
                <TabsTrigger value="crypto">Crypto</TabsTrigger>
              </TabsList>
              <TabsContent value="news" className="h-[calc(100vh-140px)] overflow-auto">
                <NewsPanel />
              </TabsContent>
              <TabsContent value="social" className="h-[calc(100vh-140px)] overflow-auto">
                <div className="p-4 space-y-4">
                  <h3 className="text-lg font-semibold">Community Updates</h3>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="border-b pb-3 last:border-b-0">
                      <div className="flex items-center mb-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 mr-2 flex-shrink-0"></div>
                        <div>
                          <div className="font-medium text-sm">CarEnthusiast{i}</div>
                          <div className="text-xs text-muted-foreground">{i}h ago</div>
                        </div>
                      </div>
                      <p className="text-sm">Just spotted this rare find at the local meet! Anyone know more about these limited editions? #VehicleSpotting #RareCars</p>
                    </div>
                  ))}
                </div>
              </TabsContent>
              <TabsContent value="crypto" className="h-[calc(100vh-140px)] overflow-auto">
                <div className="p-4">
                  <h3 className="text-lg font-semibold mb-3">Vehicle Tokens</h3>
                  <div className="space-y-3">
                    {["CAR", "RIDE", "DRIV", "AUTO", "MOTO"].map((symbol, i) => (
                      <div key={symbol} className="flex items-center justify-between border-b pb-2">
                        <div className="flex items-center">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-2">
                            {symbol.substring(0, 1)}
                          </div>
                          <div>
                            <div>{symbol}</div>
                            <div className="text-xs text-muted-foreground">Vehicle {i+1} Token</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={i % 2 === 0 ? "text-green-500" : "text-red-500"}>
                            ${(Math.random() * 10).toFixed(2)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {i % 2 === 0 ? "+" : "-"}{(Math.random() * 5).toFixed(2)}%
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </Card>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};

export default Home;
