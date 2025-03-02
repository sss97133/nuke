
import { useState } from 'react';
import { PlanStep, TheoremData } from '../types';

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
