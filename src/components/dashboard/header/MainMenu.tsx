import { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarSeparator, MenubarShortcut, MenubarTrigger } from "@/components/ui/menubar";

interface MainMenuProps {
  handleMenuAction: (action: string) => void;
}

export const MainMenu = ({ handleMenuAction }: MainMenuProps) => {
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
    </Menubar>
  );
};