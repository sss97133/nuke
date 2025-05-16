
import { LucideIcon } from "lucide-react";
import {
  Plus,
  LayoutDashboard,
  SlidersHorizontal,
  Activity,
  Settings,
  Building2,
  Wrench,
  Search,
  TrendingUp,
  Aperture,
  PlaySquare,
  Download,
  Upload,
  Terminal,
  Layout,
  FileText,
  Blocks,
  KanbanSquare,
  Wallet,
  Contact2,
  Lightbulb
} from "lucide-react";

export interface SearchResult {
  title: string;
  description: string;
  icon: LucideIcon;
  action: string;
}

interface SearchResultsProps {
  query: string;
  handleSelect: (action: string) => void;
}

export const SearchResults = ({ query, handleSelect }: SearchResultsProps) => {
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
