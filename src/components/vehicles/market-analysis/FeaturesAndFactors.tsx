
import { Card } from "@/components/ui/card";
import { Award, DollarSign } from "lucide-react";

interface FeaturesAndFactorsProps {
  uniqueFeatures: string[];
  valueFactors: string[];
}

export const FeaturesAndFactors = ({ uniqueFeatures, valueFactors }: FeaturesAndFactorsProps) => {
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <Award className="h-5 w-5 text-[#283845] mt-1" />
          <div>
            <h4 className="font-mono text-sm font-semibold mb-2">
              Unique Features
            </h4>
            <ul className="space-y-2">
              {uniqueFeatures.map((feature, index) => (
                <li
                  key={index}
                  className="font-mono text-sm text-[#283845]"
                >
                  {feature}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-start gap-4">
          <DollarSign className="h-5 w-5 text-[#283845] mt-1" />
          <div>
            <h4 className="font-mono text-sm font-semibold mb-2">
              Value Factors
            </h4>
            <ul className="space-y-2">
              {valueFactors.map((factor, index) => (
                <li
                  key={index}
                  className="font-mono text-sm text-[#283845]"
                >
                  {factor}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
};
