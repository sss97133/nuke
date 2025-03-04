
import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  Home, 
  Compass, 
  Wrench, 
  Book, 
  Award, 
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
  Hammer,
  Droplets,
  Battery,
  Gauge,
  Wallet,
  Coins,
  Video,
  Atom,
  Users,
  Menu,
  ShoppingCart,
  GraduationCap,
  LogIn
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useAuthState } from '@/hooks/auth/use-auth-state';

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  isCollapsed: boolean;
  onClick?: () => void;
}

const NavItem = ({ to, icon, label, isActive, isCollapsed, onClick }: NavItemProps) => {
  return (
    <Link 
      to={to} 
      className={cn(
        "flex items-center gap-3 px-2 sm:px-3 py-1.5 sm:py-2 rounded-md transition-colors",
        isCollapsed ? "justify-center" : "",
        isActive 
          ? "bg-primary text-primary-foreground" 
          : "hover:bg-primary/10 text-foreground"
      )}
      onClick={onClick}
    >
      {icon}
      {!isCollapsed && <span className="text-sm sm:text-base truncate">{label}</span>}
    </Link>
  );
};

export const NavSidebar = () => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { isCompleted, isLoading: onboardingLoading } = useOnboarding();
  const { session, loading: authLoading } = useAuthState();
  
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth < 768) {
        setIsCollapsed(true);
      }
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  const getNavItems = () => {
    const isAuthenticated = !!session;
    const items = [];
    
    // Always show home
    items.push({ to: "/", icon: <Home className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Home" });
    
    // Add auth items if not authenticated
    if (!isAuthenticated && !authLoading) {
      items.push({ to: "/login", icon: <LogIn className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Login" });
      return items;
    }
    
    // Add the rest of the items for authenticated users
    items.push(
      { to: "/explore", icon: <Atom className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Explore" },
      { to: "/marketplace", icon: <ShoppingCart className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Marketplace" }
    );
    
    if (!onboardingLoading && isCompleted === false) {
      items.push({ 
        to: "/onboarding", 
        icon: <GraduationCap className="h-4 w-4 sm:h-5 sm:w-5" />, 
        label: "Onboarding" 
      });
    }
    
    return [
      ...items,
      { to: "/skills", icon: <Wrench className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Skills" },
      { to: "/achievements", icon: <Award className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Achievements" },
      { to: "/maintenance", icon: <Hammer className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Maintenance" },
      { to: "/service", icon: <Settings className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Service" },
      { to: "/schedule", icon: <Calendar className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Schedule" },
      { to: "/analytics", icon: <BarChart3 className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Analytics" },
      { to: "/fuel", icon: <Droplets className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Fuel Tracking" },
      { to: "/diagnostics", icon: <Gauge className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Diagnostics" },
      { to: "/parts", icon: <Battery className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Parts" },
      { to: "/service-history", icon: <Timer className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Service History" },
      { to: "/studio", icon: <Video className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Studio" },
      { to: "/tokens", icon: <Coins className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Token Management" },
      { to: "/token-staking", icon: <Wallet className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Token Staking" },
      { to: "/glossary", icon: <Book className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Glossary" },
      { to: "/sitemap", icon: <Map className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Sitemap" },
      { to: "/documentation", icon: <FileText className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Documentation" },
      { to: "/import", icon: <FileInput className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Import" },
      { to: "/discovered-vehicles", icon: <Car className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Vehicles" },
      { to: "/team-members", icon: <Users className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Team Members" },
      { to: "/profile", icon: <User className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Profile" },
    ];
  };

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };
  
  const closeMenu = () => {
    setIsOpen(false);
  };

  if (isMobile) {
    return (
      <>
        <div className="fixed top-3 left-3 z-40">
          <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="md:hidden h-9 w-9">
                <Menu className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-64 sm:w-[270px]">
              <div className="p-3 sm:p-4 flex items-center justify-between border-b">
                <span className="font-semibold text-sm sm:text-base">Vehicle Manager</span>
              </div>
              <ScrollArea className="h-[calc(100vh-57px)]">
                <div className="p-2 space-y-1">
                  {getNavItems().map((item) => (
                    <NavItem
                      key={item.to}
                      to={item.to}
                      icon={item.icon}
                      label={item.label}
                      isActive={location.pathname === item.to}
                      isCollapsed={false}
                      onClick={closeMenu}
                    />
                  ))}
                </div>
              </ScrollArea>
            </SheetContent>
          </Sheet>
        </div>
      </>
    );
  }

  return (
    <div 
      className={cn(
        "flex flex-col h-screen border-r border-border bg-background transition-all hidden md:flex",
        isCollapsed ? "w-14 sm:w-16" : "w-48 sm:w-64"
      )}
    >
      <div className="p-3 sm:p-4 flex items-center justify-between border-b">
        {!isCollapsed && <span className="font-semibold text-sm sm:text-base">Vehicle Manager</span>}
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={toggleCollapse}
          className="ml-auto h-7 w-7 sm:h-8 sm:w-8"
        >
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {getNavItems().map((item) => (
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
}
