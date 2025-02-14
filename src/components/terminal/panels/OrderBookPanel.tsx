
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";

export const OrderBookPanel = () => {
  return (
    <ScrollArea className="h-[85vh] p-4">
      <div className="space-y-4">
        <h3 className="text-sm font-mono">Order Book</h3>
        
        <div className="space-y-2">
          <div className="grid grid-cols-3 text-xs font-mono text-muted-foreground mb-1">
            <div>Price (USD)</div>
            <div className="text-right">Amount</div>
            <div className="text-right">Total</div>
          </div>
          
          {/* Sell orders */}
          <div className="space-y-1">
            {[115, 114, 113, 112, 111].map((price) => (
              <div key={price} className="grid grid-cols-3 text-xs font-mono text-red-500">
                <div>{price}.00</div>
                <div className="text-right">1,000</div>
                <div className="text-right">{price * 1000}</div>
              </div>
            ))}
          </div>

          <Card className="bg-gray-800 p-2 my-2">
            <div className="text-center font-mono text-lg">$110.45</div>
            <div className="text-center text-xs text-green-500">+2.3%</div>
          </Card>

          {/* Buy orders */}
          <div className="space-y-1">
            {[110, 109, 108, 107, 106].map((price) => (
              <div key={price} className="grid grid-cols-3 text-xs font-mono text-green-500">
                <div>{price}.00</div>
                <div className="text-right">1,000</div>
                <div className="text-right">{price * 1000}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
};
