import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
const mockNews = [{
  id: 1,
  time: "13:45",
  title: "NUKE Token Integration Expands to Major DEXes",
  source: "CryptoNews"
}, {
  id: 2,
  time: "12:30",
  title: "Vehicle Management DAO Proposal Passes with 92% Approval",
  source: "DAONews"
}, {
  id: 3,
  time: "11:15",
  title: "Q3 Token Burning Event Scheduled for Next Week",
  source: "TokenNews"
}, {
  id: 4,
  time: "10:00",
  title: "New Staking Rewards Program Announced",
  source: "DeFiUpdate"
}, {
  id: 5,
  time: "09:30",
  title: "Market Analysis: NUKE Token Shows Strong Growth",
  source: "CryptoAnalytics"
}];
export const NewsPanel = () => {
  return <ScrollArea className="h-[85vh] p-4">
      <div className="space-y-4">
        <h3 className="text-sm font-mono">Latest News</h3>
        
        <div className="space-y-2">
          {mockNews.map(news => <Card key={news.id} className="p-3 bg-gray-400 hover:bg-gray-300">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>{news.time}</span>
                <span>{news.source}</span>
              </div>
              <p className="text-sm font-mono">{news.title}</p>
            </Card>)}
        </div>
      </div>
    </ScrollArea>;
};