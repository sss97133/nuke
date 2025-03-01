
import { Button } from "@/components/ui/button";
import { Home, Compass, Activity, Briefcase, ShoppingBag, Video, Settings, FileInput, ChevronDown, Bell, PanelLeft, Save } from "lucide-react";
import { Link } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const NavButtons = () => {
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mr-2">
        <Link to="/">
          <Home className="h-4 w-4 mr-1" />
          Home
        </Link>
      </Button>
      
      <Button asChild variant="ghost" size="sm" className="mr-2">
        <Link to="/discover">
          <Compass className="h-4 w-4 mr-1" />
          Discover
        </Link>
      </Button>
      
      {/* Business Tools Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="mr-2">
            <Briefcase className="h-4 w-4 mr-1" />
            Business
            <ChevronDown className="h-3 w-3 ml-1 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="bg-popover">
          <DropdownMenuItem asChild>
            <Link to="/track" className="flex items-center w-full">
              <Activity className="h-4 w-4 mr-2" />
              Track
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/professional-dashboard" className="flex items-center w-full">
              <Briefcase className="h-4 w-4 mr-2" />
              Pro Dashboard
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/tokens" className="flex items-center w-full">
              <ShoppingBag className="h-4 w-4 mr-2" />
              Tokens
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Media Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="mr-2">
            <Video className="h-4 w-4 mr-1" />
            Media
            <ChevronDown className="h-3 w-3 ml-1 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="bg-popover">
          <DropdownMenuItem asChild>
            <Link to="/streaming" className="flex items-center w-full">
              <Video className="h-4 w-4 mr-2" />
              Streaming
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/import" className="flex items-center w-full">
              <FileInput className="h-4 w-4 mr-2" />
              Import
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Settings Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="mr-2">
            <Settings className="h-4 w-4 mr-1" />
            Settings
            <ChevronDown className="h-3 w-3 ml-1 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="bg-popover">
          <DropdownMenuItem asChild>
            <Link to="/settings" className="flex items-center w-full">
              <PanelLeft className="h-4 w-4 mr-2" />
              Preferences
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/settings?tab=notifications" className="flex items-center w-full">
              <Bell className="h-4 w-4 mr-2" />
              Notifications
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/settings?tab=data" className="flex items-center w-full">
              <Save className="h-4 w-4 mr-2" />
              Data Management
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};
