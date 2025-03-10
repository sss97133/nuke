import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart, LineChart, Briefcase } from 'lucide-react'; // Using existing icons

const BloombergTerminal = () => {
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bloomberg Terminal</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={activeTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview" onClick={() => setActiveTab('overview')}>
              <Briefcase className="mr-2 h-4 w-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="marketData" onClick={() => setActiveTab('marketData')}>
              <LineChart className="mr-2 h-4 w-4" />
              Market Data
            </TabsTrigger>
            <TabsTrigger value="analytics" onClick={() => setActiveTab('analytics')}>
              <BarChart className="mr-2 h-4 w-4" />
              Analytics
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <div>
              <h3 className="text-lg font-semibold">Overview</h3>
              <p>Key metrics and summary data.</p>
            </div>
          </TabsContent>
          <TabsContent value="marketData">
            <div>
              <h3 className="text-lg font-semibold">Market Data</h3>
              <p>Real-time market information.</p>
            </div>
          </TabsContent>
          <TabsContent value="analytics">
            <div>
              <h3 className="text-lg font-semibold">Analytics</h3>
              <p>In-depth data analysis and insights.</p>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default BloombergTerminal;
