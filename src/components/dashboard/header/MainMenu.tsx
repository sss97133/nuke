
import { Menubar, MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem, MenubarSeparator, MenubarShortcut } from "@/components/ui/menubar";
import { FileIcon, Settings, Layout, Wrench, PanelLeft, HelpCircle, Map, BookOpen } from "lucide-react";

interface MainMenuProps {
  handleMenuAction: (action: string) => void;
}

export const MainMenu = ({ handleMenuAction }: MainMenuProps) => {
  return (
    <Menubar className="border-none bg-transparent">
      <MenubarMenu>
        <MenubarTrigger className="text-[11px]">File</MenubarTrigger>
        <MenubarContent>
          <MenubarItem onClick={() => handleMenuAction('new_project')}>
            New Project
            <MenubarShortcut>⌘N</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onClick={() => handleMenuAction('new_vehicle')}>
            New Vehicle
          </MenubarItem>
          <MenubarItem onClick={() => handleMenuAction('new_inventory')}>
            New Inventory
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => handleMenuAction('import')}>
            Import...
            <MenubarShortcut>⌘I</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onClick={() => handleMenuAction('export')}>
            Export...
            <MenubarShortcut>⌘E</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => handleMenuAction('sitemap')}>
            <Map className="mr-2 h-4 w-4" />
            Sitemap
            <MenubarShortcut>⌘M</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onClick={() => handleMenuAction('glossary')}>
            <BookOpen className="mr-2 h-4 w-4" />
            Glossary
            <MenubarShortcut>⌘G</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => handleMenuAction('exit')}>
            Exit
            <MenubarShortcut>⌘Q</MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className="text-[11px]">Edit</MenubarTrigger>
        <MenubarContent>
          <MenubarItem onClick={() => handleMenuAction('preferences')}>
            Preferences
            <MenubarShortcut>⌘,</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => handleMenuAction('studio_config')}>
            Studio Configuration
          </MenubarItem>
          <MenubarItem onClick={() => handleMenuAction('workspace_settings')}>
            Workspace Settings
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className="text-[11px]">View</MenubarTrigger>
        <MenubarContent>
          <MenubarItem onClick={() => handleMenuAction('toggle_sidebar')}>
            Toggle Sidebar
            <MenubarShortcut>⌘\</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onClick={() => handleMenuAction('toggle_activity')}>
            Activity Panel
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => handleMenuAction('professional_dashboard')}>
            Professional Dashboard
          </MenubarItem>
          <MenubarItem onClick={() => handleMenuAction('inventory_view')}>
            Inventory
          </MenubarItem>
          <MenubarItem onClick={() => handleMenuAction('service_view')}>
            Service
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => handleMenuAction('sitemap')}>
            Sitemap
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => handleMenuAction('toggle_theme')}>
            Toggle Theme
            <MenubarShortcut>⌘T</MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className="text-[11px]">Tools</MenubarTrigger>
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
          <MenubarItem onClick={() => handleMenuAction('toggle_assistant')}>
            AI Assistant
            <MenubarShortcut>⌘A</MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className="text-[11px]">Window</MenubarTrigger>
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
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className="text-[11px]">Help</MenubarTrigger>
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
      </MenubarMenu>
    </Menubar>
  );
};
