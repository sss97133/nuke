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
  LogIn,
  UserPlus,
  UploadCloud
} from 'lucide-react';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useAuthState } from '@/hooks/auth/use-auth-state';
import { NavItem } from './types';
import { isPublicPath } from '@/routes/routeConfig';

export const useNavItems = () => {
  const navigate = useNavigate();
  const { isCompleted, isLoading: onboardingLoading } = useOnboarding();
  const { session, loading: authLoading } = useAuthState();
  
  const handleLoginClick = (e: React.MouseEvent) => {
    e.preventDefault();
    console.log("Login clicked, navigating to /login");
    navigate('/login');
  };
  
  const handleRegisterClick = (e: React.MouseEvent) => {
    e.preventDefault();
    console.log("Register clicked, navigating to /register");
    navigate('/register');
  };
  
  const getNavItems = (): NavItem[] => {
    const isAuthenticated = !!session;
    const items: NavItem[] = [];
    
    // Always include these public items
    items.push(
      { to: "/", icon: <Home className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Home" },
      { to: "/explore", icon: <Atom className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Explore" },
      { to: "/marketplace", icon: <ShoppingCart className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Marketplace" },
      { to: "/glossary", icon: <Book className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Glossary" },
      { to: "/documentation", icon: <FileText className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Documentation" },
      { to: "/sitemap", icon: <Map className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Sitemap" }
    );
    
    // Add login/register for unauthenticated users
    if (!isAuthenticated && !authLoading) {
      return [
        ...items,
        { 
          to: "#", 
          icon: <LogIn className="h-4 w-4 sm:h-5 sm:w-5" />, 
          label: "Login",
          onClick: handleLoginClick
        },
        { 
          to: "#", 
          icon: <UserPlus className="h-4 w-4 sm:h-5 sm:w-5" />, 
          label: "Sign Up",
          onClick: handleRegisterClick
        }
      ];
    }
    
    // Add onboarding for authenticated users who haven't completed it
    if (isAuthenticated && !onboardingLoading && isCompleted === false) {
      items.push({ 
        to: "/onboarding", 
        icon: <GraduationCap className="h-4 w-4 sm:h-5 sm:w-5" />, 
        label: "Onboarding" 
      });
    }
    
    // Add all authenticated items
    if (isAuthenticated) {
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
        { to: "/import", icon: <FileInput className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Import" },
        { to: "/discovered-vehicles", icon: <Car className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Vehicles" },
        { to: "/import-vehicles", icon: <UploadCloud className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Import Vehicles" },
        { to: "/team-members", icon: <Users className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Team Members" },
        { to: "/profile", icon: <User className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Profile" },
        { to: "/streaming", icon: <Video className="h-4 w-4 sm:h-5 sm:w-5" />, label: "Streaming" }
      ];
    }
    
    return items;
  };

  return { getNavItems };
};
