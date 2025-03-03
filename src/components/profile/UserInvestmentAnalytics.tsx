
import React from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  Legend,
  CartesianGrid,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { 
  Coins, 
  TrendingUp, 
  BarChart3, 
  PieChart as PieChartIcon,
  ExternalLink 
} from 'lucide-react';
import { Link } from 'react-router-dom';

interface InvestmentDataPoint {
  category: string;
  value: number;
  roi: number;
  color: string;
}

interface UserInvestmentAnalyticsProps {
  userId: string;
  investmentData: InvestmentDataPoint[];
  totalInvested: number;
  averageROI: number;
  isLoading?: boolean;
}

export const UserInvestmentAnalytics = ({ 
  userId, 
  investmentData, 
  totalInvested,
  averageROI,
  isLoading = false 
}: UserInvestmentAnalyticsProps) => {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Investment Analytics</CardTitle>
          <CardDescription>Loading your investment data...</CardDescription>
        </CardHeader>
        <CardContent className="h-80 flex items-center justify-center">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
        </CardContent>
      </Card>
    );
  }

  const roiStatus = averageROI >= 0 ? 'positive' : 'negative';

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-background border p-3 rounded-md shadow-md">
          <p className="text-sm font-medium">{data.category}</p>
          <div className="space-y-1 mt-2">
            <p className="text-xs">
              Investment: ${data.value.toLocaleString()}
            </p>
            <p className="text-xs">
              ROI: {data.roi >= 0 ? '+' : ''}{data.roi}%
            </p>
          </div>
        </div>
      );
    }
    return null;
  };

  const RADIAN = Math.PI / 180;
  const renderPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, index }: any) => {
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    
    if (percent < 0.05) return null;
    
    return (
      <text 
        x={x} 
        y={y} 
        fill="white" 
        textAnchor={x > cx ? 'start' : 'end'} 
        dominantBaseline="central"
        className="text-xs font-medium"
      >
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Investment Analytics</CardTitle>
            <CardDescription>Your financial activities and returns</CardDescription>
          </div>
          <div className="flex items-center gap-2 bg-muted px-3 py-1 rounded-full">
            <Coins className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">${totalInvested.toLocaleString()}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-background/50 p-3 rounded-lg border">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total Invested</span>
              <Coins className="h-4 w-4 text-primary" />
            </div>
            <div className="flex items-end gap-2 mt-1">
              <span className="text-2xl font-bold">${totalInvested.toLocaleString()}</span>
            </div>
          </div>
          
          <div className="bg-background/50 p-3 rounded-lg border">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Average ROI</span>
              <TrendingUp className={`h-4 w-4 ${roiStatus === 'positive' ? 'text-green-500' : 'text-red-500'}`} />
            </div>
            <div className="flex items-end gap-2 mt-1">
              <span className={`text-2xl font-bold ${roiStatus === 'positive' ? 'text-green-500' : 'text-red-500'}`}>
                {averageROI >= 0 ? '+' : ''}{averageROI}%
              </span>
            </div>
          </div>
        </div>
        
        <Tabs defaultValue="allocation">
          <TabsList className="grid grid-cols-2 mb-4">
            <TabsTrigger value="allocation" className="flex items-center gap-2">
              <PieChartIcon className="h-4 w-4" />
              Allocation
            </TabsTrigger>
            <TabsTrigger value="performance" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Performance
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="allocation" className="mt-0">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={investmentData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={renderPieLabel}
                    outerRadius={120}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {investmentData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </TabsContent>
          
          <TabsContent value="performance" className="mt-0">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={investmentData}
                  margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis 
                    dataKey="category" 
                    tick={{ fontSize: 12 }}
                    tickMargin={10}
                  />
                  <YAxis 
                    tick={{ fontSize: 12 }}
                    tickMargin={10}
                    unit="%"
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar 
                    dataKey="roi" 
                    name="ROI" 
                    radius={[4, 4, 0, 0]}
                  >
                    {investmentData.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={entry.roi >= 0 ? '#10b981' : '#ef4444'} 
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-center mt-6">
          <Link to="/token-staking">
            <Button className="w-full gap-2">
              <ExternalLink className="h-4 w-4" />
              View Full Investment Dashboard
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
};
