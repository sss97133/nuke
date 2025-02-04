import { MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem, MenubarSeparator } from "@/components/ui/menubar";

interface MainMenuProps {
  handleMenuAction: (action: string) => void;
}

export const MainMenu = ({ handleMenuAction }: MainMenuProps) => {
  return (
    <MenubarMenu>
      <MenubarTrigger>File</MenubarTrigger>
      <MenubarContent>
        <MenubarItem onClick={() => handleMenuAction('new_vehicle')}>
          New Vehicle
        </MenubarItem>
        <MenubarItem onClick={() => handleMenuAction('new_inventory')}>
          New Inventory
        </MenubarItem>
        <MenubarSeparator />
        <MenubarItem onClick={() => handleMenuAction('studio_config')}>
          Studio Configuration
        </MenubarItem>
        <MenubarSeparator />
        <MenubarItem onClick={() => handleMenuAction('exit')}>
          Exit
        </MenubarItem>
      </MenubarContent>
    </MenubarMenu>
  );
};
