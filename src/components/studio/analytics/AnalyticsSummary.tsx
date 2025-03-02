
import { Card, CardContent } from "@/components/ui/card";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import type { AnalyticsSummaryProps } from "../types/analyticsTypes";

export const AnalyticsSummary = ({
  title,
  value,
  description,
  icon,
  change
}: AnalyticsSummaryProps) => {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <div className="flex items-baseline">
              <h4 className="text-2xl font-bold">{value}</h4>
              {change && (
                <div className={`ml-2 flex items-center text-sm ${change.isPositive ? 'text-green-500' : 'text-red-500'}`}>
                  {change.isPositive ? <ArrowUpIcon className="h-4 w-4 mr-0.5" /> : <ArrowDownIcon className="h-4 w-4 mr-0.5" />}
                  {Math.abs(change.value)}%
                </div>
              )}
            </div>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          {icon && (
            <div className="rounded-md bg-muted p-2">
              {icon}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
