import { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarSeparator, MenubarShortcut, MenubarTrigger } from "@/components/ui/menubar";
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";

interface DashboardHeaderProps {
  handleMenuAction: (action: string) => void;
}

export const DashboardHeader = ({ handleMenuAction }: DashboardHeaderProps) => {
  const { theme, setTheme } = useTheme();

  return (
    <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center h-6 px-2 bg-[#CCCCCC] border-b border-[#8E9196] shadow-classic">
        <div className="flex-1">
          <Menubar className="border-none bg-transparent">
            <MenubarMenu>
              <MenubarTrigger className="text-xs font-bold">🍎</MenubarTrigger>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger className="text-xs font-bold">File</MenubarTrigger>
              <MenubarContent>
                <MenubarItem onClick={() => handleMenuAction('new_vehicle')}>
                  New Vehicle <MenubarShortcut>⌘N</MenubarShortcut>
                </MenubarItem>
                <MenubarItem onClick={() => handleMenuAction('new_inventory')}>
                  New Inventory Item
                </MenubarItem>
                <MenubarSeparator />
                <MenubarItem onClick={() => handleMenuAction('exit')}>
                  Exit <MenubarShortcut>⌘Q</MenubarShortcut>
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger className="text-xs font-bold">Edit</MenubarTrigger>
              <MenubarContent>
                <MenubarItem onClick={() => handleMenuAction('undo')}>
                  Undo <MenubarShortcut>⌘Z</MenubarShortcut>
                </MenubarItem>
                <MenubarItem onClick={() => handleMenuAction('redo')}>
                  Redo <MenubarShortcut>⌘⇧Z</MenubarShortcut>
                </MenubarItem>
                <MenubarSeparator />
                <MenubarItem onClick={() => handleMenuAction('preferences')}>
                  Preferences
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger className="text-xs font-bold">View</MenubarTrigger>
              <MenubarContent>
                <MenubarItem onClick={() => handleMenuAction('toggle_terminal')}>
                  Toggle Terminal <MenubarShortcut>⌘T</MenubarShortcut>
                </MenubarItem>
                <MenubarItem onClick={() => handleMenuAction('refresh')}>
                  Refresh <MenubarShortcut>⌘R</MenubarShortcut>
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger className="text-xs font-bold">Special</MenubarTrigger>
              <MenubarContent>
                <MenubarItem onClick={() => handleMenuAction('scan_vin')}>
                  Scan VIN
                </MenubarItem>
                <MenubarItem onClick={() => handleMenuAction('batch_import')}>
                  Batch Import
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger className="text-xs font-bold">Help</MenubarTrigger>
              <MenubarContent>
                <MenubarItem onClick={() => handleMenuAction('documentation')}>
                  Documentation
                </MenubarItem>
                <MenubarItem onClick={() => handleMenuAction('about')}>
                  About TAMS
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>
          </Menubar>
        </div>
        <div className="flex items-center gap-2 ml-2">
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="p-1 rounded-md hover:bg-accent"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>
          <span className="text-[10px] text-primary">Battery: 100%</span>
          <span className="text-[10px] text-primary">{new Date().toLocaleTimeString()}</span>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex justify-between items-center h-14">
          <div className="flex items-center space-x-4">
            <span className="text-sm text-primary font-mono">TAMS/v1.0</span>
            <span className="text-sm text-muted-foreground font-mono">SID:{new Date().getTime()}</span>
          </div>
          <button
            onClick={() => handleMenuAction('exit')}
            className="classic-button"
          >
            EXIT_SYS
          </button>
        </div>
      </div>
    </header>
  );
};
