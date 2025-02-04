import { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarSeparator, MenubarShortcut, MenubarTrigger } from "@/components/ui/menubar";
import { Settings2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface MainMenuProps {
  handleMenuAction: (action: string) => void;
}

export const MainMenu = ({ handleMenuAction }: MainMenuProps) => {
  const navigate = useNavigate();

  return (
    <Menubar className="border-none bg-transparent">
      <MenubarMenu>
        <MenubarTrigger className="font-system text-xs px-2 py-1 cursor-default">
          File
        </MenubarTrigger>
        <MenubarContent>
          <MenubarItem onClick={() => handleMenuAction("new_vehicle")}>
            New Vehicle
            <MenubarShortcut>⌘N</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onClick={() => handleMenuAction("new_inventory")}>
            New Inventory
            <MenubarShortcut>⇧⌘N</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => handleMenuAction("exit")}>
            Exit
            <MenubarShortcut>⌘Q</MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className="font-system text-xs px-2 py-1 cursor-default">
          Edit
        </MenubarTrigger>
        <MenubarContent>
          <MenubarItem onClick={() => handleMenuAction("preferences")}>
            Preferences
            <MenubarShortcut>⌘,</MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className="font-system text-xs px-2 py-1 cursor-default">
          View
        </MenubarTrigger>
        <MenubarContent>
          <MenubarItem onClick={() => handleMenuAction("toggle_assistant")}>
            Toggle Assistant
            <MenubarShortcut>⌘A</MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className="font-system text-xs px-2 py-1 cursor-default">
          Help
        </MenubarTrigger>
        <MenubarContent>
          <MenubarItem onClick={() => handleMenuAction("help")}>
            Documentation
            <MenubarShortcut>⌘H</MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className="font-system text-xs px-2 py-1 cursor-default flex items-center gap-1">
          <Settings2 className="w-4 h-4" />
          Back Office
        </MenubarTrigger>
        <MenubarContent>
          <MenubarItem onClick={() => handleMenuAction("professional_dashboard")}>
            Professional Dashboard
            <MenubarShortcut>⌘P</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onClick={() => handleMenuAction("skill_management")}>
            Skill Management
            <MenubarShortcut>⌘S</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onClick={() => handleMenuAction("achievements")}>
            Achievements
            <MenubarShortcut>⌘M</MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
};