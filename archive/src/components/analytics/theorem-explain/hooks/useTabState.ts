
import { useState, useEffect } from 'react';

/**
 * Custom hook to manage the active tab state in the TheoremExplainAgent
 * 
 * This hook tracks which tab is currently active (planner, code, or output)
 * and provides functions to change the active tab. It also includes debugging
 * to track tab changes in the console.
 * 
 * @returns {Object} Object containing the active tab state and setter function
 * @returns {string} activeTab - Current active tab ("planner", "code", or "output")
 * @returns {Function} setActiveTab - Function to update the active tab
 */
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
