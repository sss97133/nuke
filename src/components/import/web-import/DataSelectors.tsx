
import React from 'react';
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const DataSelectors: React.FC = () => {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="selector">Data Selector (CSS/XPath)</Label>
        <Input id="selector" placeholder="table.data-table or //table[@class='data-table']" />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="auth">Authentication (Optional)</Label>
        <Textarea id="auth" placeholder="API key or auth details if required" />
      </div>
    </>
  );
};
