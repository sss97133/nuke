
import { Card } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";

interface MarketPositionCardProps {
  marketAnalysis: string;
}

export const MarketPositionCard = ({ marketAnalysis }: MarketPositionCardProps) => {
  return (
    <Card className="p-6">
      <div className="flex items-start gap-4">
        <TrendingUp className="h-5 w-5 text-[#283845] mt-1" />
        <div>
          <h4 className="font-mono text-sm font-semibold mb-2">
            Market Position
          </h4>
          <p className="font-mono text-sm text-[#283845]">
            {marketAnalysis}
          </p>
        </div>
      </div>
    </Card>
  );
};
