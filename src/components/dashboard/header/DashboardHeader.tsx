import { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarSeparator, MenubarShortcut, MenubarTrigger } from "@/components/ui/menubar";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Apple } from "lucide-react";

interface DashboardHeaderProps {
  handleMenuAction: (action: string) => void;
}

export const DashboardHeader = ({ handleMenuAction }: DashboardHeaderProps) => {
  return (
    <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center h-6 px-2 bg-secondary border-b border-border shadow-classic">
        <Menubar className="border-none bg-transparent">
          <MenubarMenu>
            <MenubarTrigger className="p-1">
              <Apple className="h-4 w-4 text-red-500" />
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

        <div className="flex-1">
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
        </div>

        <div className="flex items-center gap-2 ml-2">
          <ThemeToggle />
          <span className="text-[10px] text-foreground">Battery: 100%</span>
          <span className="text-[10px] text-foreground">{new Date().toLocaleTimeString()}</span>
        </div>
      </div>
    </header>
  );
};