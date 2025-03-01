
import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  Home, 
  Compass, 
  Wrench, 
  Book, 
  Award, 
  Video, 
  FileText, 
  Map, 
  FileInput, 
  Car, 
  User,
  ChevronLeft,
  ChevronRight,
  Settings,
  Calendar,
  BarChart3,
  Timer,
  Tool,
  FuelPump,
  Battery,
  Gauge
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  isCollapsed: boolean;
}

const NavItem = ({ to, icon, label, isActive, isCollapsed }: NavItemProps) => {
  return (
    <Link 
      to={to} 
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
        isCollapsed ? "justify-center" : "",
        isActive 
          ? "bg-primary text-primary-foreground" 
          : "hover:bg-primary/10 text-foreground"
      )}
    >
      {icon}
      {!isCollapsed && <span>{label}</span>}
    </Link>
  );
};

export const NavSidebar = () => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const location = useLocation();
  
  const navItems = [
    { to: "/dashboard", icon: <Home className="h-5 w-5" />, label: "Dashboard" },
    { to: "/onboarding", icon: <Compass className="h-5 w-5" />, label: "Onboarding" },
    { to: "/skills", icon: <Wrench className="h-5 w-5" />, label: "Skills" },
    { to: "/achievements", icon: <Award className="h-5 w-5" />, label: "Achievements" },
    { to: "/maintenance", icon: <Tool className="h-5 w-5" />, label: "Maintenance" },
    { to: "/service", icon: <Settings className="h-5 w-5" />, label: "Service" },
    { to: "/schedule", icon: <Calendar className="h-5 w-5" />, label: "Schedule" },
    { to: "/analytics", icon: <BarChart3 className="h-5 w-5" />, label: "Analytics" },
    { to: "/fuel", icon: <FuelPump className="h-5 w-5" />, label: "Fuel Tracking" },
    { to: "/diagnostics", icon: <Gauge className="h-5 w-5" />, label: "Diagnostics" },
    { to: "/parts", icon: <Battery className="h-5 w-5" />, label: "Parts" },
    { to: "/service-history", icon: <Timer className="h-5 w-5" />, label: "Service History" },
    { to: "/studio", icon: <Video className="h-5 w-5" />, label: "Studio" },
    { to: "/glossary", icon: <Book className="h-5 w-5" />, label: "Glossary" },
    { to: "/sitemap", icon: <Map className="h-5 w-5" />, label: "Sitemap" },
    { to: "/documentation", icon: <FileText className="h-5 w-5" />, label: "Documentation" },
    { to: "/import", icon: <FileInput className="h-5 w-5" />, label: "Import" },
    { to: "/discovered-vehicles", icon: <Car className="h-5 w-5" />, label: "Vehicles" },
    { to: "/profile", icon: <User className="h-5 w-5" />, label: "Profile" },
  ];

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  return (
    <div 
      className={cn(
        "flex flex-col h-screen border-r border-border bg-background transition-all",
        isCollapsed ? "w-16" : "w-64"
      )}
    >
      <div className="p-4 flex items-center justify-between border-b">
        {!isCollapsed && <span className="font-semibold">Vehicle Manager</span>}
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={toggleCollapse}
          className="ml-auto"
        >
          {isCollapsed ? <ChevronRight /> : <ChevronLeft />}
        </Button>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {navItems.map((item) => (
            <NavItem
              key={item.to}
              to={item.to}
              icon={item.icon}
              label={item.label}
              isActive={location.pathname === item.to}
              isCollapsed={isCollapsed}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};
