
import { useState } from 'react';

interface UseCalendarNavigationProps {
  initialDate: Date;
  onDateSelect: (date: Date) => void;
}

export const useCalendarNavigation = ({ 
  initialDate, 
  onDateSelect 
}: UseCalendarNavigationProps) => {
  const [currentView, setCurrentView] = useState<'month' | 'week' | 'day'>('week');

  const handleNavigate = (direction: 'prev' | 'next') => {
    const newDate = new Date(initialDate);
    
    if (direction === 'prev') {
      if (currentView === 'day') {
        newDate.setDate(newDate.getDate() - 1);
      } else if (currentView === 'week') {
        newDate.setDate(newDate.getDate() - 7);
      } else {
        newDate.setMonth(newDate.getMonth() - 1);
      }
    } else {
      if (currentView === 'day') {
        newDate.setDate(newDate.getDate() + 1);
      } else if (currentView === 'week') {
        newDate.setDate(newDate.getDate() + 7);
      } else {
        newDate.setMonth(newDate.getMonth() + 1);
      }
    }
    
    onDateSelect(newDate);
  };

  return {
    currentView,
    setCurrentView,
    handleNavigate
  };
};
