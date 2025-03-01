
import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { QuickStatsCard } from "../cards/QuickStatsCard";

export const DashboardTabHeader = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Quick stats */}
      <QuickStatsCard 
        title="Skills Progress" 
        value="73%" 
        progress={73}
        footer="12 of 16 skills completed"
      />
      
      <QuickStatsCard 
        title="Certifications" 
        value="3"
        footer={
          <div className="flex items-center">
            <span className="text-green-500 mr-1">+1</span> 
            <span>since last month</span>
          </div>
        }
      />
      
      <QuickStatsCard 
        title="Upcoming Deadlines" 
        value="4"
        footer={
          <div className="flex items-center">
            <span className="text-orange-500 mr-1">2 due soon</span>
          </div>
        }
      />
    </div>
  );
};
