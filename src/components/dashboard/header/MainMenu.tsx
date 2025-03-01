
import { Menubar, MenubarMenu, MenubarTrigger } from "@/components/ui/menubar";
import { FileMenuItems, EditMenuItems, ViewMenuItems } from "./menu/MenuItems";
import { ToolsMenuItems, WindowMenuItems, HelpMenuItems } from "./menu/MoreMenuItems";
import { Button } from "@/components/ui/button";
import { Home, Compass, Briefcase, Video } from "lucide-react";
import { Link } from "react-router-dom";

interface MainMenuProps {
  handleMenuAction: (action: string) => void;
}

export const MainMenu = ({ handleMenuAction }: MainMenuProps) => {
  return (
    <div className="flex items-center">
      <div className="flex items-center">
        {/* Navigation Buttons */}
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
        
        <Button asChild variant="ghost" size="icon" className="p-1">
          <Link to="/professional-dashboard">
            <Briefcase className="h-4 w-4" />
          </Link>
        </Button>
        
        <Button asChild variant="ghost" size="icon" className="p-1">
          <Link to="/streaming">
            <Video className="h-4 w-4" />
          </Link>
        </Button>

        {/* Menu Items */}
        <Menubar className="border-none bg-transparent py-0">
          <MenubarMenu>
            <MenubarTrigger className="text-[11px]">File</MenubarTrigger>
            <FileMenuItems handleMenuAction={handleMenuAction} />
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="text-[11px]">Edit</MenubarTrigger>
            <EditMenuItems handleMenuAction={handleMenuAction} />
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="text-[11px]">View</MenubarTrigger>
            <ViewMenuItems handleMenuAction={handleMenuAction} />
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="text-[11px]">Tools</MenubarTrigger>
            <ToolsMenuItems handleMenuAction={handleMenuAction} />
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="text-[11px]">Window</MenubarTrigger>
            <WindowMenuItems handleMenuAction={handleMenuAction} />
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="text-[11px]">Help</MenubarTrigger>
            <HelpMenuItems handleMenuAction={handleMenuAction} />
          </MenubarMenu>
        </Menubar>
      </div>
    </div>
  );
};
