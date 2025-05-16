
import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string;
  description: string;
  icon: LucideIcon;
  onClick?: () => void;
  isError?: boolean;
}

const StatCard = ({ title, value, description, icon: Icon, onClick, isError = false }: StatCardProps) => {
  return (
    <Card 
      className={`transition-all duration-200 ${onClick ? 'cursor-pointer hover:shadow-md' : ''} ${isError ? 'border-red-200' : ''}`}
      onClick={onClick}
    >
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-medium">{title}</h3>
          <div className={`p-2 rounded-full ${isError ? 'bg-red-50' : 'bg-primary/10'}`}>
            <Icon className={`h-5 w-5 ${isError ? 'text-red-400' : 'text-primary'}`} />
          </div>
        </div>
        <div>
          <div className={`text-2xl font-bold ${isError ? 'text-muted-foreground' : ''}`}>
            {isError ? "Unavailable" : value}
          </div>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
          {isError && (
            <p className="text-xs text-red-500 mt-1">Error loading data</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default StatCard;
