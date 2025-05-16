
import React, { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnalyticsSummary } from './AnalyticsSummary';
import { PerformanceMetrics } from './PerformanceMetrics';
import { EventTimeline } from './EventTimeline';
import { UsageChart } from './UsageChart';
import { DeviceStats } from './DeviceStats';
import { Clock, Timer, Radio, Users } from 'lucide-react';
import type { TimelineEventProps } from '../types/analyticsTypes';

export const StudioAnalytics = () => {
  const [activeTab, setActiveTab] = useState("overview");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Simulate data loading
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 1000);
    
    return () => clearTimeout(timer);
  }, []);

  // Mock data for the charts
  const usageData = [
    { name: 'Mon', recording: 43, streaming: 25 },
    { name: 'Tue', recording: 52, streaming: 36 },
    { name: 'Wed', recording: 22, streaming: 18 },
    { name: 'Thu', recording: 65, streaming: 45 },
    { name: 'Fri', recording: 70, streaming: 55 },
    { name: 'Sat', recording: 38, streaming: 30 },
    { name: 'Sun', recording: 15, streaming: 10 },
  ];

  // Mock events for the timeline
  const events: TimelineEventProps[] = [
    {
      id: '1',
      timestamp: new Date(Date.now() - 1000 * 60 * 15),
      title: 'Recording stopped',
      description: 'Weekly podcast session completed',
      type: 'recording'
    },
    {
      id: '2',
      timestamp: new Date(Date.now() - 1000 * 60 * 60),
      title: 'Stream started',
      description: 'Live Q&A session with 42 viewers',
      type: 'streaming'
    },
    {
      id: '3',
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3),
      title: 'System update',
      description: 'Firmware updated to version 2.4.5',
      type: 'system'
    },
    {
      id: '4',
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24),
      title: 'Network connectivity issue',
      description: 'Temporary connection loss for 2 minutes',
      type: 'error'
    },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-4">Studio Analytics</h2>
        <p className="text-muted-foreground mb-6">
          Track your studio performance metrics and monitor recording and streaming activities.
        </p>
      </div>

      <Tabs defaultValue="overview" value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="recording">Recording</TabsTrigger>
          <TabsTrigger value="streaming">Streaming</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>
        
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            <AnalyticsSummary 
              title="Total Recording Time" 
              value="16h 42m"
              description="This week"
              icon={<Clock className="h-4 w-4" />}
              change={{ value: 12.5, isPositive: true }}
            />
            <AnalyticsSummary 
              title="Average Session Length" 
              value="47m"
              description="Based on last 10 sessions"
              icon={<Timer className="h-4 w-4" />}
              change={{ value: 5.3, isPositive: true }}
            />
            <AnalyticsSummary 
              title="Stream Time" 
              value="8h 15m"
              description="This week"
              icon={<Radio className="h-4 w-4" />}
              change={{ value: 3.2, isPositive: false }}
            />
            <AnalyticsSummary 
              title="Audience Reach" 
              value="824"
              description="Total viewers this month"
              icon={<Users className="h-4 w-4" />}
              change={{ value: 22.8, isPositive: true }}
            />
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <UsageChart 
                data={usageData}
                title="Weekly Usage"
                description="Recording and streaming minutes per day"
              />
            </div>
            <div>
              <EventTimeline events={events} />
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <DeviceStats 
              cpuUsage={42}
              memoryUsage={68}
              diskSpace={256}
              networkSpeed={24.5}
            />
            <PerformanceMetrics />
          </div>
        </TabsContent>
        
        <TabsContent value="recording" className="space-y-6 mt-6">
          <div className="grid grid-cols-1 gap-6">
            <UsageChart 
              data={usageData}
              title="Recording Analytics"
              description="Detailed recording metrics by session"
            />
          </div>
        </TabsContent>
        
        <TabsContent value="streaming" className="space-y-6 mt-6">
          <div className="grid grid-cols-1 gap-6">
            <UsageChart 
              data={usageData}
              title="Streaming Analytics"
              description="Stream performance and audience metrics"
            />
          </div>
        </TabsContent>
        
        <TabsContent value="performance" className="space-y-6 mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <DeviceStats 
              cpuUsage={42}
              memoryUsage={68}
              diskSpace={256}
              networkSpeed={24.5}
            />
            <PerformanceMetrics />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};
