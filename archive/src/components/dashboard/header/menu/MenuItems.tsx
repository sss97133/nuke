
import { MenubarContent, MenubarItem, MenubarSeparator, MenubarShortcut } from "@/components/ui/menubar";
import { FileIcon, Map, BookOpen, ShoppingBag, Vote, Lock } from "lucide-react";

interface MenuItemsProps {
  handleMenuAction: (action: string) => void;
  category: string;
}

export const FileMenuItems = ({ handleMenuAction }: { handleMenuAction: (action: string) => void }) => {
  return (
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
  );
};

export const EditMenuItems = ({ handleMenuAction }: { handleMenuAction: (action: string) => void }) => {
  return (
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
  );
};

export const ViewMenuItems = ({ handleMenuAction }: { handleMenuAction: (action: string) => void }) => {
  return (
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
      <MenubarItem onClick={() => handleMenuAction('token_management')}>
        <ShoppingBag className="mr-2 h-4 w-4" />
        Token Management
      </MenubarItem>
      <MenubarItem onClick={() => handleMenuAction('dao_governance')}>
        <Vote className="mr-2 h-4 w-4" />
        DAO Governance
      </MenubarItem>
      <MenubarItem onClick={() => handleMenuAction('access_control')}>
        <Lock className="mr-2 h-4 w-4" />
        Access Control
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
  );
};
