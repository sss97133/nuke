import { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarSeparator, MenubarShortcut, MenubarTrigger } from "@/components/ui/menubar";
import { Atom } from "lucide-react";

interface AppMenuProps {
  handleMenuAction: (action: string) => void;
}

export const AppMenu = ({ handleMenuAction }: AppMenuProps) => {
  return (
    <Menubar className="border-none bg-transparent">
      <MenubarMenu>
        <MenubarTrigger className="p-1">
          <Atom className="h-4 w-4 text-red-500" />
        </MenubarTrigger>
        <MenubarContent>
          <MenubarItem onClick={() => handleMenuAction("about")}>
            About NUKE
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => handleMenuAction("preferences")}>
            System Preferences...
            <MenubarShortcut>⌘,</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => handleMenuAction("sleep")}>
            Sleep
          </MenubarItem>
          <MenubarItem onClick={() => handleMenuAction("restart")}>
            Restart...
          </MenubarItem>
          <MenubarItem onClick={() => handleMenuAction("shutdown")}>
            Shut Down...
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => handleMenuAction("exit")}>
            Log Out
            <MenubarShortcut>⇧⌘Q</MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
};