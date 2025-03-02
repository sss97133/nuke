
import { useState, useEffect } from 'react';

export const useTabState = () => {
  const [activeTab, setActiveTab] = useState("planner");
  
  // Debug tracking active tab
  useEffect(() => {
    console.log("Active tab changed to:", activeTab);
  }, [activeTab]);
  
  return {
    activeTab,
    setActiveTab
  };
};
