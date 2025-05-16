
import { Button } from "@/components/ui/button";
import { Home, Compass, Briefcase, Video, ChevronDown, Activity, ShoppingBag, FileInput } from "lucide-react";
import { Link } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "next-themes";

export const NavButtons = () => {
  const { theme, setTheme } = useTheme();

  return (
    <>
      <Button asChild variant="ghost" size="icon" className="p-1">
        <Link to="/">
          <Home className="h-4 w-4" />
        </Link>
      </Button>
      
      <Button asChild variant="ghost" size="icon" className="p-1">
        <Link to="/discover">
          <Compass className="h-4 w-4" />
        </Link>
      </Button>
      
      {/* Business Tools Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="p-1">
            <Briefcase className="h-4 w-4" />
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
          <Button variant="ghost" size="icon" className="p-1">
            <Video className="h-4 w-4" />
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
    </>
  );
};
