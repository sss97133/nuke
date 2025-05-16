
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import MaintenanceRecommendation from "../MaintenanceRecommendation";
import { MaintenanceRecommendation as MaintenanceRecommendationType } from "@/components/maintenance/types";

interface RecommendationsTabProps {
  recommendations: MaintenanceRecommendationType[];
}

const RecommendationsTab: React.FC<RecommendationsTabProps> = ({ recommendations }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Maintenance Recommendations</CardTitle>
        <CardDescription>Personalized recommendations based on your vehicles</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {recommendations.map((item) => (
            <MaintenanceRecommendation key={item.id} {...item} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default RecommendationsTab;
