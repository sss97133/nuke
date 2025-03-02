
import { Card, CardContent } from "@/components/ui/card";
import { ScheduleSummaryProps } from './types/scheduleTypes';

export const ScheduleSummary = ({
  title,
  value,
  description,
  icon
}: ScheduleSummaryProps) => {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <div className="flex items-baseline">
              <h4 className="text-2xl font-bold">{value}</h4>
            </div>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          {icon && (
            <div className="rounded-md bg-primary/10 p-2 text-primary">
              {icon}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
