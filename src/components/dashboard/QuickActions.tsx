
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

// Define actions with their routes
interface ActionItem {
  label: string;
  route: string;
}

const QuickActions = () => {
  const navigate = useNavigate();
  
  // Define actions and their corresponding routes
  const quickActions: ActionItem[] = [
    { label: "Add new vehicle", route: "/add-vehicle" },
    { label: "Schedule service", route: "/schedule" },
    { label: "View achievements", route: "/achievements" },
    { label: "Import data", route: "/import" },
    { label: "Team management", route: "/team-members" }
  ];

  const handleActionClick = (route: string) => {
    navigate(route);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Actions</CardTitle>
        <CardDescription>Common tasks and shortcuts</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {quickActions.map((action, i) => (
            <button 
              key={i} 
              onClick={() => handleActionClick(action.route)}
              className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-primary/10 transition-colors"
            >
              {action.label}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default QuickActions;
