
import React from 'react';
import { useNavigate } from 'react-router-dom';
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
  ShoppingCart,
  GraduationCap,
  LogIn
} from 'lucide-react';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useAuthState } from '@/hooks/auth/use-auth-state';
import { NavItem } from './types';

export const useNavItems = () => {
  const navigate = useNavigate();
  const { isCompleted, isLoading: onboardingLoading } = useOnboarding();
  const { session, loading: authLoading } = useAuthState();
  
  // Handle direct navigation to login
  const handleLoginClick = (e: React.MouseEvent) => {
    e.preventDefault();
    console.log("Login clicked, navigating to /login");
    navigate('/login');
  };
  
  const getNavItems = (): NavItem[] => {
    const isAuthenticated = !!session;
    const items: NavItem[] = [];
    
    // Always show home
    items.push({ to: "/", icon: <Home className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Home" });
    
    // Add auth items if not authenticated
    if (!isAuthenticated && !authLoading) {
      // Using a special item for login that will use the handleLoginClick function
      return [
        ...items,
        { 
          to: "#", // Use # to prevent default navigation
          icon: <LogIn className="h-4 w-4 sm:h-5 sm:w-5" />, 
          label: "Login",
          onClick: handleLoginClick
        }
      ];
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

  return { getNavItems };
};
