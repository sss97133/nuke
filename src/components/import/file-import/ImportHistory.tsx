
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export const ImportHistory: React.FC = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Import History</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {[
            { file: "vehicles-may.csv", date: "May 10, 2024", records: 45 },
            { file: "inventory-q1.xlsx", date: "Apr 02, 2024", records: 128 },
            { file: "services-2023.json", date: "Mar 15, 2024", records: 312 }
          ].map((item, index) => (
            <div key={index} className="border-l-2 border-primary pl-3 py-1">
              <div className="flex justify-between">
                <h4 className="font-medium text-sm">{item.file}</h4>
                <span className="text-xs text-muted-foreground">{item.date}</span>
              </div>
              <p className="text-xs text-muted-foreground">{item.records} records</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
