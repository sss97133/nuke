import { Menubar, MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem, MenubarSeparator } from "@/components/ui/menubar";

interface MainMenuProps {
  handleMenuAction: (action: string) => void;
}

export const MainMenu = ({ handleMenuAction }: MainMenuProps) => {
  return (
    <Menubar className="border-none bg-transparent">
      <MenubarMenu>
        <MenubarTrigger className="text-[11px]">File</MenubarTrigger>
        <MenubarContent>
          <MenubarItem onClick={() => handleMenuAction('new_vehicle')}>
            New Vehicle
          </MenubarItem>
          <MenubarItem onClick={() => handleMenuAction('new_inventory')}>
            New Inventory
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => handleMenuAction('studio_config_v1')}>
            Studio Configuration (v1)
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => handleMenuAction('exit')}>
            Exit
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      
      <MenubarMenu>
        <MenubarTrigger className="text-[11px]">Edit</MenubarTrigger>
        <MenubarContent>
          <MenubarItem onClick={() => handleMenuAction('preferences')}>
            Preferences
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      
      <MenubarMenu>
        <MenubarTrigger className="text-[11px]">View</MenubarTrigger>
        <MenubarContent>
          <MenubarItem onClick={() => handleMenuAction('professional_dashboard')}>
            Professional Dashboard
          </MenubarItem>
          <MenubarItem onClick={() => handleMenuAction('skill_management')}>
            Skill Management
          </MenubarItem>
          <MenubarItem onClick={() => handleMenuAction('achievements')}>
            Achievements
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      
      <MenubarMenu>
        <MenubarTrigger className="text-[11px]">Help</MenubarTrigger>
        <MenubarContent>
          <MenubarItem onClick={() => handleMenuAction('toggle_assistant')}>
            AI Assistant
          </MenubarItem>
          <MenubarItem onClick={() => handleMenuAction('help')}>
            Documentation
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
};