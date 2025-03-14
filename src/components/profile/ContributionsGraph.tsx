
import type { Database } from '../types';
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer } from 'recharts';
import { format, parseISO, subMonths } from 'date-fns';
import { GitCommit } from 'lucide-react';

interface Contribution {
  date: string;
  label_count: number;
}

interface ContributionData {
  date: string;
  value: number;
  color: string;
}

export const ContributionsGraph = ({ userId }: { userId: string }) => {
  const { data: contributions, isLoading } = useQuery({
    queryKey: ['video-contributions', userId],
    queryFn: async () => {
      const endDate = new Date();
      const startDate = subMonths(endDate, 12);

      const { data, error } = await supabase
  if (error) console.error("Database query error:", error);
        .from('video_analysis_contributions')
        .select('date, label_count')
        .eq('user_id', userId)
        .gte('date', startDate.toISOString())
        .lte('date', endDate.toISOString());

      if (error) throw error;
      return data as Contribution[];
    }
  });

  if (isLoading) {
    return (
      <div className="h-[200px] flex items-center justify-center">
        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const formatData = (data: Contribution[] = []): ContributionData[] => {
    return data.map(contribution => {
      const value = contribution.label_count;
      let color;
      if (value === 0) color = '#ebedf0';
      else if (value <= 5) color = '#9be9a8';
      else if (value <= 10) color = '#40c463';
      else if (value <= 20) color = '#30a14e';
      else color = '#216e39';

      return {
        date: contribution.date,
        value,
        color
      };
    });
  };

  const formattedData = formatData(contributions);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-background border border-border p-2 rounded-lg shadow-lg">
          <p className="text-sm font-medium">{format(parseISO(data.date), 'MMM d, yyyy')}</p>
          <p className="text-sm text-muted-foreground">{data.value} labels added</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 mb-2">
        <GitCommit className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-medium">Video Analysis Contributions</h3>
      </div>
      
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 0, bottom: 20, left: 0 }}>
            <XAxis
              dataKey="date"
              tickFormatter={(date) => format(parseISO(date), 'MMM')}
              stroke="#888888"
              fontSize={12}
            />
            <YAxis hide domain={[0, 'auto']} />
            <Tooltip content={<CustomTooltip />} />
            <Scatter data={formattedData} shape="square">
              {formattedData.map((entry, index) => (
                <Cell key={index} fill={entry.color} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
