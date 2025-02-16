import { useState } from "react";
import React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Command } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Plus,
  Wrench,
  Keyboard,
  HelpCircle,
  LogOut,
  SlidersHorizontal,
  LayoutDashboard,
  Activity,
  Search,
  Lightbulb,
  Download,
  Upload,
  Terminal,
  Settings,
  PlaySquare,
  Aperture,
  MapPin,
  LucideIcon,
  Home,
  Building2,
  Wallet,
  Contact2,
  User2,
  FileJson2,
  FileText,
  Layout,
  GitPullRequest,
  KanbanSquare,
  Blocks,
  PanelsLeftRight,
  PanelsTopBottom,
  Plane,
  FlipVertical,
  FlipHorizontal,
  FlipVertical2,
  FlipHorizontal2,
  TrendingUp
} from "lucide-react";
import { useTheme } from "next-themes";
import { useDashboardState } from "../hooks/useDashboardState";
import { handleSignOut, handleKeyboardShortcuts, handleProjectNavigation } from "../hooks/utils/navigationUtils";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

interface DashboardHeaderProps {
  handleMenuAction: (action: string) => void;
}

interface SearchResult {
  title: string;
  description: string;
  icon: LucideIcon;
  action: string;
}

const SearchResults = ({ query, handleSelect }: { query: string; handleSelect: (action: string) => void }) => {
  const results: SearchResult[] = [
    { title: "New Project", description: "Create a new project workspace", icon: Plus, action: 'new_project' },
    { title: "Professional Dashboard", description: "Access professional tools", icon: LayoutDashboard, action: 'professional_dashboard' },
    { title: "Skill Management", description: "Manage and update your skills", icon: SlidersHorizontal, action: 'skill_management' },
    { title: "Achievements", description: "View your achievements and milestones", icon: Activity, action: 'achievements' },
    { title: "Preferences", description: "Customize your settings", icon: Settings, action: 'preferences' },
    { title: "Inventory View", description: "Manage your inventory", icon: Building2, action: 'inventory_view' },
    { title: "Service View", description: "Access service-related tools", icon: Wrench, action: 'service_view' },
    { title: "VIN Scanner", description: "Scan and decode VINs", icon: Search, action: 'vin_scanner' },
    { title: "Market Analysis", description: "Analyze market trends", icon: TrendingUp, action: 'market_analysis' },
    { title: "Studio Workspace", description: "Access the studio workspace", icon: Aperture, action: 'studio_workspace' },
    { title: "Streaming Setup", description: "Configure your streaming setup", icon: PlaySquare, action: 'streaming_setup' },
    { title: "Import", description: "Import data", icon: Download, action: 'import' },
    { title: "Export", description: "Export data", icon: Upload, action: 'export' },
    { title: "Terminal", description: "Access the terminal", icon: Terminal, action: 'terminal' },
    { title: "Sitemap", description: "View the sitemap", icon: Layout, action: 'sitemap' },
    { title: "Glossary", description: "Access the glossary", icon: FileText, action: 'glossary' },
    { title: "Algorithms", description: "View algorithms", icon: Blocks, action: 'algorithms' },
    { title: "DAO Governance", description: "Manage DAO governance", icon: KanbanSquare, action: 'dao_governance' },
    { title: "Access Control", description: "Manage access control", icon: GitPullRequest, action: 'access_control' },
    { title: "Token Management", description: "Manage tokens", icon: Wallet, action: 'token_management' },
    { title: "Token Analytics", description: "View token analytics", icon: Contact2, action: 'token_analytics' },
    { title: "AI Explanations", description: "Get AI explanations", icon: Lightbulb, action: 'ai_explanations' },
  ].filter(result => result.title.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="mt-2">
      {results.length > 0 ? (
        results.map((result) => (
          <div
            key={result.title}
            className="flex items-center p-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => handleSelect(result.action)}
          >
            <result.icon className="mr-2 h-4 w-4" />
            <div>
              <div className="font-medium">{result.title}</div>
              <div className="text-sm text-gray-500">{result.description}</div>
            </div>
          </div>
        ))
      ) : (
        <div className="p-2 text-center text-gray-500">No results found.</div>
      )}
    </div>
  );
};

export const DashboardHeader = ({ handleMenuAction }: DashboardHeaderProps) => {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const { toast } = useToast();

  const handleToggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      setOpen(!open);
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 't') {
      event.preventDefault();
      handleToggleTheme();
    }
  };

  const handleSearchSelect = (action: string) => {
    handleProjectNavigation(navigate, toast, action);
    setOpen(false);
  };

  React.useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [theme]);

  return (
    <div className="border-b">
      <div className="flex h-16 items-center px-4">
        <div className="relative flex-1 max-w-lg">
          <Input
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Type a command or search..."
            className="w-full"
          />
          {open && searchValue && (
            <div className="absolute w-full mt-2 bg-white dark:bg-gray-800 rounded-md shadow-lg border">
              <SearchResults query={searchValue} handleSelect={handleSearchSelect} />
            </div>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="ml-2 h-8 w-8 p-0">
              <Avatar className="h-8 w-8">
                <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
                <AvatarFallback>CN</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => handleProjectNavigation(navigate, toast, 'preferences')}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleKeyboardShortcuts(toast)}>
              <Keyboard className="mr-2 h-4 w-4" />
              Keyboard Shortcuts
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleMenuAction('help')}>
              <HelpCircle className="mr-2 h-4 w-4" />
              Help
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => handleSignOut(navigate, toast)}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};
