
import { useState } from 'react';
import { PlanStep, TheoremData } from '../types';

/**
 * Custom hook to manage the planning process for theorem visualizations
 * 
 * This hook handles the state and logic for planning the visualization of a theorem.
 * It manages the planning steps, loading states, and provides functions to trigger
 * the planning process.
 * 
 * The planning process consists of several sequential steps:
 * 1. Scene Outline - Establishing the initial context and scope
 * 2. Vision Storyboard Plan - Creating a visual representation flow
 * 3. Technical Implementation Plan - Planning code structure and algorithms
 * 4. Animation & Narration Plan - Detailing user experience elements
 * 
 * @param {TheoremData | undefined} selectedTheorem - The currently selected theorem
 * @returns {Object} Object containing planning state and control functions
 * @returns {boolean} loading - Whether a planning operation is in progress
 * @returns {boolean} planning - Whether planning is actively happening
 * @returns {boolean} planCompleted - Whether all planning steps are completed
 * @returns {Array<PlanStep>} planSteps - Array of planning steps with completion status
 * @returns {Function} startPlanning - Trigger the planning process for the selected theorem
 */
export const usePlanner = (selectedTheorem?: TheoremData) => {
  const [loading, setLoading] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [planCompleted, setPlanCompleted] = useState(false);
  
  const [planSteps, setPlanSteps] = useState<PlanStep[]>([
    { title: "Scene Outline", description: "Initial context and scope", completed: false },
    { title: "Vision Storyboard Plan", description: "Visual representation flow", completed: false },
    { title: "Technical Implementation Plan", description: "Code structure and algorithms", completed: false },
    { title: "Animation & Narration Plan", description: "User experience details", completed: false }
  ]);
  
  // Simulates the planning process
  const startPlanning = () => {
    console.log("Starting planning with theorem:", selectedTheorem);
    setLoading(true);
    setPlanning(true);
    
    // Simulate API calls with timeouts
    let stepIndex = 0;
    const interval = setInterval(() => {
      if (stepIndex < planSteps.length) {
        setPlanSteps(prev => {
          const updated = [...prev];
          updated[stepIndex].completed = true;
          return updated;
        });
        stepIndex++;
      } else {
        clearInterval(interval);
        setPlanCompleted(true);
        setPlanning(false);
      }
    }, 1000);
    
    // Simulate completion
    setTimeout(() => {
      setLoading(false);
    }, 5000);
  };
  
  return {
    loading,
    planning,
    planCompleted,
    planSteps,
    startPlanning
  };
};
