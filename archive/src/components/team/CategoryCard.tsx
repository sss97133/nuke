
import React from 'react';
import { LucideIcon } from 'lucide-react';
import { Card, CardHeader, CardContent, CardDescription, CardTitle } from "@/components/ui/card";

interface CategoryCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  children?: React.ReactNode;
}

export const CategoryCard = ({ icon, title, description, children }: CategoryCardProps) => (
  <Card>
    <CardHeader>
      <div className="flex items-center gap-2">
        {icon}
        <CardTitle>{title}</CardTitle>
      </div>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
    <CardContent>
      {children || <p className="text-muted-foreground">No {title.toLowerCase()} added yet. Add {title.toLowerCase()} to enhance your vehicle management.</p>}
    </CardContent>
  </Card>
);
