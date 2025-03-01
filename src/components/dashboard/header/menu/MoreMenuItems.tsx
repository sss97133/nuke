
import { MenubarContent, MenubarItem, MenubarSeparator, MenubarShortcut } from "@/components/ui/menubar";
import { ShoppingBag, HelpCircle, Settings } from "lucide-react";
import { useState } from "react";
import { DocumentationDialog } from "@/components/documentation/DocumentationDialog";
import { AboutDialog } from "@/components/documentation/AboutDialog";

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
      <MenubarItem onClick={() => handleMenuAction('preferences')}>
        <Settings className="mr-2 h-4 w-4" />
        System Preferences
        <MenubarShortcut>⌘,</MenubarShortcut>
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
  const [docDialogOpen, setDocDialogOpen] = useState(false);
  const [aboutDialogOpen, setAboutDialogOpen] = useState(false);
  
  return (
    <MenubarContent>
      <MenubarItem onClick={() => setDocDialogOpen(true)}>
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
      <MenubarItem onClick={() => setAboutDialogOpen(true)}>
        About
      </MenubarItem>
      
      <DocumentationDialog open={docDialogOpen} onOpenChange={setDocDialogOpen} />
      <AboutDialog open={aboutDialogOpen} onOpenChange={setAboutDialogOpen} />
    </MenubarContent>
  );
};
