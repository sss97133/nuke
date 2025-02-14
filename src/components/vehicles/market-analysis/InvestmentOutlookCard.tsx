
import { Card } from "@/components/ui/card";
import { formatCurrency } from "./utils";
import { Analysis } from "./types";

interface InvestmentOutlookCardProps {
  investmentOutlook: string;
  priceAnalysis: Analysis["priceAnalysis"];
}

export const InvestmentOutlookCard = ({ investmentOutlook, priceAnalysis }: InvestmentOutlookCardProps) => {
  return (
    <Card className="p-6">
      <h4 className="font-mono text-sm font-semibold mb-2">
        Investment Outlook
      </h4>
      <p className="font-mono text-sm text-[#283845]">
        {investmentOutlook}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <span className="font-mono text-sm text-[#666]">
            Estimated Value:
          </span>
          <p className="font-mono text-lg font-semibold">
            {formatCurrency(priceAnalysis.estimatedValue)}
          </p>
        </div>
        <div>
          <span className="font-mono text-sm text-[#666]">
            Market Trend:
          </span>
          <p className="font-mono text-lg font-semibold capitalize">
            {priceAnalysis.trendDirection}
          </p>
        </div>
      </div>
    </Card>
  );
};
