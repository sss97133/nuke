
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface QuickStatsCardProps {
  title: string;
  value: string | number;
  progress?: number;
  footer?: React.ReactNode;
}

export const QuickStatsCard = ({ title, value, progress, footer }: QuickStatsCardProps) => {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {progress !== undefined && (
          <Progress value={progress} className="h-2 mt-2" />
        )}
        {footer && (
          <div className="text-xs text-muted-foreground mt-1">{footer}</div>
        )}
      </CardContent>
    </Card>
  );
};
