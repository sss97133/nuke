
import { Card } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";

interface StatsCardProps {
  icon: LucideIcon;
  title: string;
  value: number | string;
  onClick: () => void;
}

export const StatsCard = ({ icon: Icon, title, value, onClick }: StatsCardProps) => {
  return (
    <Card 
      className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" />
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <p className="mt-2 text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">Click to view details</p>
    </Card>
  );
};
