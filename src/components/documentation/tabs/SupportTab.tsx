
import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { HelpCircle } from 'lucide-react';

export const SupportTab = () => {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-center p-10">
          <HelpCircle className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-xl font-medium mb-2">Support Resources</h3>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            Get help, submit tickets, and connect with our support team
          </p>
          <div className="flex justify-center gap-4">
            <button className="bg-primary text-primary-foreground px-4 py-2 rounded-md">
              Contact Support
            </button>
            <button className="border border-input bg-background hover:bg-accent hover:text-accent-foreground px-4 py-2 rounded-md">
              Troubleshooting Guide
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
