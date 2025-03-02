
import React from 'react';
import TheoremExplainAgent from '@/components/analytics/TheoremExplainAgent';

const Analytics = () => {
  console.log("Analytics page rendering");
  
  return (
    <div className="container py-6">
      <h1 className="text-3xl font-bold mb-8">Analytics Dashboard</h1>
      
      <div className="space-y-8">
        <TheoremExplainAgent />
      </div>
    </div>
  );
};

export default Analytics;
