
import { Card } from "@/components/ui/card";
import { CandlestickChart } from "lucide-react";
import { TokenAnalysis } from "./types";
import { formatCurrency } from "./utils";

interface DerivativesCardProps {
  derivativesData: TokenAnalysis["derivativesData"];
}

export const DerivativesCard = ({ derivativesData }: DerivativesCardProps) => {
  return (
    <Card className="p-6">
      <div className="flex items-start gap-4">
        <CandlestickChart className="h-5 w-5 text-[#283845] mt-1" />
        <div className="w-full">
          <h4 className="font-mono text-sm font-semibold mb-4">
            Derivatives Market
          </h4>
          <div className="divide-y">
            {derivativesData.map((derivative, index) => (
              <div
                key={index}
                className="py-3 grid grid-cols-3 gap-4"
              >
                <div className="font-mono text-sm">
                  {derivative.type}
                </div>
                <div className="font-mono text-sm">
                  {formatCurrency(derivative.price)}
                </div>
                <div className="font-mono text-sm text-[#666]">
                  Expires: {new Date(derivative.expirationDate).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
};
