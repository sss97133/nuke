
import { ReactNode } from 'react';

export interface AnalyticsSummaryProps {
  title: string;
  value: string | number;
  description?: string;
  icon?: ReactNode;
  change?: {
    value: number;
    isPositive: boolean;
  };
}

export interface TimelineEventProps {
  id: string;
  timestamp: Date;
  title: string;
  description?: string;
  type: 'recording' | 'streaming' | 'system' | 'error';
}

export interface EventTimelineProps {
  events: TimelineEventProps[];
}

export interface PerformanceMetricProps {
  title: string;
  current: number;
  previous?: number;
  unit: string;
  change?: number;
}

export interface DeviceStatsProps {
  cpuUsage: number;
  memoryUsage: number;
  diskSpace: number;
  networkSpeed: number;
}

export interface AnalyticsChartProps {
  data: any[];
  title: string;
  description?: string;
}
