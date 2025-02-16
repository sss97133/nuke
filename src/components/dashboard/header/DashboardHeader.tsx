import { useState } from "react";
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
  Gear,
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
  Terminal2,
  Settings,
  Stream,
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
  PanelLeft,
  PanelRight,
  PanelTop,
  PanelBottom,
  PanelTopBottom,
  PanelLeftRight,
  Panel,
  Split,
  SplitVertical,
  SplitHorizontal,
  SplitDiagonal,
  SplitVertical2,
  SplitHorizontal2,
  SplitDiagonal2,
  SplitVertical3,
  SplitHorizontal3,
  SplitDiagonal3,
  SplitVertical4,
  SplitHorizontal4,
  SplitDiagonal4,
  SplitVertical5,
  SplitHorizontal5,
  SplitDiagonal5,
  SplitVertical6,
  SplitHorizontal6,
  SplitDiagonal6,
  SplitVertical7,
  SplitHorizontal7,
  SplitDiagonal7,
  SplitVertical8,
  SplitHorizontal8,
  SplitDiagonal8,
  SplitVertical9,
  SplitHorizontal9,
  SplitDiagonal9,
  SplitVertical10,
  SplitHorizontal10,
  SplitDiagonal10,
  SplitVertical11,
  SplitHorizontal11,
  SplitDiagonal11,
  SplitVertical12,
  SplitHorizontal12,
  SplitDiagonal12,
  SplitVertical13,
  SplitHorizontal13,
  SplitDiagonal13,
  SplitVertical14,
  SplitHorizontal14,
  SplitDiagonal14,
  SplitVertical15,
  SplitHorizontal15,
  SplitDiagonal15,
  SplitVertical16,
  SplitHorizontal16,
  SplitDiagonal16,
  SplitVertical17,
  SplitHorizontal17,
  SplitDiagonal17,
  SplitVertical18,
  SplitHorizontal18,
  SplitDiagonal18,
  SplitVertical19,
  SplitHorizontal19,
  SplitDiagonal19,
  SplitVertical20,
  SplitHorizontal20,
  SplitDiagonal20,
  SplitVertical21,
  SplitHorizontal21,
  SplitDiagonal21,
  SplitVertical22,
  SplitHorizontal22,
  SplitDiagonal22,
  SplitVertical23,
  SplitHorizontal23,
  SplitDiagonal23,
  SplitVertical24,
  SplitHorizontal24,
  SplitDiagonal24,
  SplitVertical25,
  SplitHorizontal25,
  SplitDiagonal25,
  SplitVertical26,
  SplitHorizontal26,
  SplitDiagonal26,
  SplitVertical27,
  SplitHorizontal27,
  SplitDiagonal27,
  SplitVertical28,
  SplitHorizontal28,
  SplitDiagonal28,
  SplitVertical29,
  SplitHorizontal29,
  SplitDiagonal29,
  SplitVertical30,
  SplitHorizontal30,
  SplitDiagonal30,
  SplitVertical31,
  SplitHorizontal31,
  SplitDiagonal31,
  SplitVertical32,
  SplitHorizontal32,
  SplitDiagonal32,
  SplitVertical33,
  SplitHorizontal33,
  SplitDiagonal33,
  SplitVertical34,
  SplitHorizontal34,
  SplitDiagonal34,
  SplitVertical35,
  SplitHorizontal35,
  SplitDiagonal35,
  SplitVertical36,
  SplitHorizontal36,
  SplitDiagonal36,
  SplitVertical37,
  SplitHorizontal37,
  SplitDiagonal37,
  SplitVertical38,
  SplitHorizontal38,
  SplitDiagonal38,
  SplitVertical39,
  SplitHorizontal39,
  SplitDiagonal39,
  SplitVertical40,
  SplitHorizontal40,
  SplitDiagonal40,
  SplitVertical41,
  SplitHorizontal41,
  SplitDiagonal41,
  SplitVertical42,
  SplitHorizontal42,
  SplitDiagonal42,
  SplitVertical43,
  SplitHorizontal43,
  SplitDiagonal43,
  SplitVertical44,
  SplitHorizontal44,
  SplitDiagonal44,
  SplitVertical45,
  SplitHorizontal45,
  SplitDiagonal45,
  SplitVertical46,
  SplitHorizontal46,
  SplitDiagonal46,
  SplitVertical47,
  SplitHorizontal47,
  SplitDiagonal47,
  SplitVertical48,
  SplitHorizontal48,
  SplitDiagonal48,
  SplitVertical49,
  SplitHorizontal49,
  SplitDiagonal49,
  SplitVertical50,
  SplitHorizontal50,
  SplitDiagonal50,
  SplitVertical51,
  SplitHorizontal51,
  SplitDiagonal51,
  SplitVertical52,
  SplitHorizontal52,
  SplitDiagonal52,
  SplitVertical53,
  SplitHorizontal53,
  SplitDiagonal53,
  SplitVertical54,
  SplitHorizontal54,
  SplitDiagonal54,
  SplitVertical55,
  SplitHorizontal55,
  SplitDiagonal55,
  SplitVertical56,
  SplitHorizontal56,
  SplitDiagonal56,
  SplitVertical57,
  SplitHorizontal57,
  SplitDiagonal57,
  SplitVertical58,
  SplitHorizontal58,
  SplitDiagonal58,
  SplitVertical59,
  SplitHorizontal59,
  SplitDiagonal59,
  SplitVertical60,
  SplitHorizontal60,
  SplitDiagonal60,
  SplitVertical61,
  SplitHorizontal61,
  SplitDiagonal61,
  SplitVertical62,
  SplitHorizontal62,
  SplitDiagonal62,
  SplitVertical63,
  SplitHorizontal63,
  SplitDiagonal63,
  SplitVertical64,
  SplitHorizontal64,
  SplitDiagonal64,
  SplitVertical65,
  SplitHorizontal65,
  SplitDiagonal65,
  SplitVertical66,
  SplitHorizontal66,
  SplitDiagonal66,
  SplitVertical67,
  SplitHorizontal67,
  SplitDiagonal67,
  SplitVertical68,
  SplitHorizontal68,
  SplitDiagonal68,
  SplitVertical69,
  SplitHorizontal69,
  SplitDiagonal69,
  SplitVertical70,
  SplitHorizontal70,
  SplitDiagonal70,
  SplitVertical71,
  SplitHorizontal71,
  SplitDiagonal71,
  SplitVertical72,
  SplitHorizontal72,
  SplitDiagonal72,
  SplitVertical73,
  SplitHorizontal73,
  SplitDiagonal73,
  SplitVertical74,
  SplitHorizontal74,
  SplitDiagonal74,
  SplitVertical75,
  SplitHorizontal75,
  SplitDiagonal75,
  SplitVertical76,
  SplitHorizontal76,
  SplitDiagonal76,
  SplitVertical77,
  SplitHorizontal77,
  SplitDiagonal77,
  SplitVertical78,
  SplitHorizontal78,
  SplitDiagonal78,
  SplitVertical79,
  SplitHorizontal79,
  SplitDiagonal79,
  SplitVertical80,
  SplitHorizontal80,
  SplitDiagonal80,
  SplitVertical81,
  SplitHorizontal81,
  SplitDiagonal81,
  SplitVertical82,
  SplitHorizontal82,
  SplitDiagonal82,
  SplitVertical83,
  SplitHorizontal83,
  SplitDiagonal83,
  SplitVertical84,
  SplitHorizontal84,
  SplitDiagonal84,
  SplitVertical85,
  SplitHorizontal85,
  SplitDiagonal85,
  SplitVertical86,
  SplitHorizontal86,
  SplitDiagonal86,
  SplitVertical87,
  SplitHorizontal87,
  SplitDiagonal87,
  SplitVertical88,
  SplitHorizontal88,
  SplitDiagonal88,
  SplitVertical89,
  SplitHorizontal89,
  SplitDiagonal89,
  SplitVertical90,
  SplitHorizontal90,
  SplitDiagonal90,
  SplitVertical91,
  SplitHorizontal91,
  SplitDiagonal91,
  SplitVertical92,
  SplitHorizontal92,
  SplitDiagonal92,
  SplitVertical93,
  SplitHorizontal93,
  SplitDiagonal93,
  SplitVertical94,
  SplitHorizontal94,
  SplitDiagonal94,
  SplitVertical95,
  SplitHorizontal95,
  SplitDiagonal95,
  SplitVertical96,
  SplitHorizontal96,
  SplitDiagonal96,
  SplitVertical97,
  SplitHorizontal97,
  SplitDiagonal97,
  SplitVertical98,
  SplitHorizontal98,
  SplitDiagonal98,
  SplitVertical99,
  SplitHorizontal99,
  SplitDiagonal99,
  SplitVertical100,
  SplitHorizontal100,
  SplitDiagonal100,
} from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { useDashboardState } from "../hooks/useDashboardState";
import { handleSignOut, handleKeyboardShortcuts, handleProjectNavigation } from "../hooks/utils/navigationUtils";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

interface DashboardHeaderProps {
  handleMenuAction: (action: string) => void;
}

const SearchResults = ({ query }: { query: string }) => {
  const results = [
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
    { title: "Streaming Setup", description: "Configure your streaming setup", icon: Stream, action: 'streaming_setup' },
    { title: "Import", description: "Import data", icon: Download, action: 'import' },
    { title: "Export", description: "Export data", icon: Upload, action: 'export' },
    { title: "Terminal", description: "Access the terminal", icon: Terminal2, action: 'terminal' },
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
    <Command.List>
      {results.length > 0 ? (
        results.map((result) => (
          <Command.Item key={result.title} onSelect={() => handleProjectNavigation(useNavigate(), useToast(), result.action)}>
            <result.icon className="mr-2 h-4 w-4" />
            <span>{result.title}</span>
            <span className="ml-auto text-xs tracking-widest text-muted-foreground">{result.description}</span>
          </Command.Item>
        ))
      ) : (
        <Command.Empty>No results found.</Command.Empty>
      )}
    </Command.List>
  );
};

export const DashboardHeader = ({ handleMenuAction }: DashboardHeaderProps) => {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const {
    showSidebar,
    setShowSidebar,
    showHelp,
    setShowHelp,
    showActivityPanel,
    setShowActivityPanel
  } = useDashboardState();
  const { toast } = useToast();

  const handleToggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  const handleToggleSidebar = () => {
    setShowSidebar(!showSidebar);
  };

  const handleToggleHelp = () => {
    setShowHelp(!showHelp);
  };

  const handleToggleActivityPanel = () => {
    setShowActivityPanel(!showActivityPanel);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      setOpen(!open);
    }

    if ((event.metaKey || event.ctrlKey) && event.key === '/') {
      event.preventDefault();
      handleToggleHelp();
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'b') {
      event.preventDefault();
      handleToggleSidebar();
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 't') {
      event.preventDefault();
      handleToggleTheme();
    }

     if ((event.metaKey || event.ctrlKey) && event.key === '\\') {
      event.preventDefault();
      handleToggleActivityPanel();
    }
  };

  React.useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showSidebar, showHelp, showActivityPanel, theme]);

  const handleCreateGarage = () => {
    navigate('/garage/import');
  };

  return (
    <div className="border-b">
      <div className="flex h-16 items-center px-4">
        <Command open={open} onOpenChange={setOpen}>
          <Command.Input value={searchValue} onValueChange={setSearchValue} placeholder="Type a command or search..." className="ml-auto w-full max-w-lg rounded-md border-0 bg-background ring-offset-background focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-2 dark:bg-background-dark" />
          {searchValue ? (
            <SearchResults query={searchValue} />
          ) : (
            <Command.List>
              <Command.Empty>No results found.</Command.Empty>
            </Command.List>
          )}
        </Command>

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
            <DropdownMenuItem onSelect={() => handleProjectNavigation(navigate, toast, 'preferences')}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => handleKeyboardShortcuts(toast)}>
              <Keyboard className="mr-2 h-4 w-4" />
              Keyboard Shortcuts
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => handleToggleHelp()}>
              <HelpCircle className="mr-2 h-4 w-4" />
              Help
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => handleSignOut(navigate, toast)}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="dashboard-menu bg-secondary/50 dark:bg-secondary-dark/50 border-t">
        <div className="container flex justify-between">
          <div className="flex">
            <div
              className="cursor-pointer border-r px-4 py-2.5 text-xs"
              onClick={() => handleMenuAction('new_vehicle')}
            >
              Add New Vehicle
            </div>
            <div
              className="cursor-pointer border-r px-4 py-2.5 text-xs"
              onClick={() => handleMenuAction('new_inventory')}
            >
              Add New Inventory
            </div>
            <div
              className="cursor-pointer border-r px-4 py-2.5 text-xs"
              onClick={() => handleMenuAction('ai_assistant')}
            >
              AI Assistant
            </div>
          </div>
          <div className="flex">
            <div
              className="cursor-pointer border-r px-4 py-2.5 text-xs"
              onClick={() => handleMenuAction('studio_config')}
            >
              Studio Config
            </div>
            <div
              className="cursor-pointer border-r px-4 py-2.5 text-xs"
              onClick={() => handleMenuAction('workspace_preview')}
            >
              Workspace Preview
            </div>
            <div
              className="cursor-pointer border-r px-4 py-2.5 text-xs"
              onClick={() => handleMenuAction('activity_panel')}
            >
              Activity Panel
            </div>
            <div 
              className="cursor-pointer border-t"
              onClick={handleCreateGarage}
            >
              Create New Garage
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
