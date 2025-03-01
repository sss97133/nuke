
import { MenubarContent, MenubarItem, MenubarSeparator, MenubarShortcut } from "@/components/ui/menubar";
import { ShoppingBag, HelpCircle } from "lucide-react";

export const ToolsMenuItems = ({ handleMenuAction }: { handleMenuAction: (action: string) => void }) => {
  return (
    <MenubarContent>
      <MenubarItem onClick={() => handleMenuAction('vin_scanner')}>
        VIN Scanner
      </MenubarItem>
      <MenubarItem onClick={() => handleMenuAction('market_analysis')}>
        Market Analysis
      </MenubarItem>
      <MenubarItem onClick={() => handleMenuAction('skill_management')}>
        Skill Management
      </MenubarItem>
      <MenubarSeparator />
      <MenubarItem onClick={() => handleMenuAction('token_analytics')}>
        <ShoppingBag className="mr-2 h-4 w-4" />
        Token Analytics
      </MenubarItem>
      <MenubarSeparator />
      <MenubarItem onClick={() => handleMenuAction('toggle_assistant')}>
        AI Assistant
        <MenubarShortcut>⌘A</MenubarShortcut>
      </MenubarItem>
    </MenubarContent>
  );
};

export const WindowMenuItems = ({ handleMenuAction }: { handleMenuAction: (action: string) => void }) => {
  return (
    <MenubarContent>
      <MenubarItem onClick={() => handleMenuAction('studio_workspace')}>
        Studio Workspace
      </MenubarItem>
      <MenubarItem onClick={() => handleMenuAction('streaming_setup')}>
        Streaming Setup
      </MenubarItem>
      <MenubarItem onClick={() => handleMenuAction('achievements')}>
        Achievements
      </MenubarItem>
      <MenubarSeparator />
      <MenubarItem onClick={() => handleMenuAction('reset_layout')}>
        Reset Layout
      </MenubarItem>
    </MenubarContent>
  );
};

export const HelpMenuItems = ({ handleMenuAction }: { handleMenuAction: (action: string) => void }) => {
  return (
    <MenubarContent>
      <MenubarItem onClick={() => handleMenuAction('documentation')}>
        Documentation
        <MenubarShortcut>⌘H</MenubarShortcut>
      </MenubarItem>
      <MenubarItem onClick={() => handleMenuAction('keyboard_shortcuts')}>
        Keyboard Shortcuts
      </MenubarItem>
      <MenubarItem onClick={() => handleMenuAction('toggle_assistant')}>
        AI Assistant
      </MenubarItem>
      <MenubarSeparator />
      <MenubarItem onClick={() => handleMenuAction('about')}>
        About
      </MenubarItem>
    </MenubarContent>
  );
};
