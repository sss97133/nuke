
import { Card } from "@/components/ui/card";
import { Wallet } from "lucide-react";
import { TokenAnalysis } from "./types";
import { formatCurrency } from "./utils";

interface TokenAnalysisCardProps {
  tokenAnalysis: TokenAnalysis;
}

export const TokenAnalysisCard = ({ tokenAnalysis }: TokenAnalysisCardProps) => {
  return (
    <Card className="p-6">
      <div className="flex items-start gap-4">
        <Wallet className="h-5 w-5 text-[#283845] mt-1" />
        <div className="w-full">
          <h4 className="font-mono text-sm font-semibold mb-4">
            Token Analysis
          </h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="font-mono text-sm text-[#666]">
                Current Token Price:
              </span>
              <p className="font-mono text-lg font-semibold">
                {formatCurrency(tokenAnalysis.currentTokenPrice)}
              </p>
            </div>
            <div>
              <span className="font-mono text-sm text-[#666]">
                24h Volume:
              </span>
              <p className="font-mono text-lg font-semibold">
                {formatCurrency(tokenAnalysis.tokenVolume24h)}
              </p>
            </div>
            <div>
              <span className="font-mono text-sm text-[#666]">
                Market Cap:
              </span>
              <p className="font-mono text-lg font-semibold">
                {formatCurrency(tokenAnalysis.marketCap)}
              </p>
            </div>
            <div>
              <span className="font-mono text-sm text-[#666]">
                Circulating Supply:
              </span>
              <p className="font-mono text-lg font-semibold">
                {tokenAnalysis.circulatingSupply.toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};
