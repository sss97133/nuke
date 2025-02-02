import { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarSeparator, MenubarShortcut, MenubarTrigger } from "@/components/ui/menubar";
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";

interface DashboardHeaderProps {
  handleMenuAction: (action: string) => void;
}

export const DashboardHeader = ({ handleMenuAction }: DashboardHeaderProps) => {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center h-6 px-2 bg-secondary border-b border-border shadow-classic dark:bg-secondary-dark dark:border-border-dark dark:shadow-classic-dark">
        <div className="flex-1">
          <Menubar className="border-none bg-transparent">
            <MenubarMenu>
              <MenubarTrigger className="text-xs font-bold">🍎</MenubarTrigger>
              <MenubarContent>
                <MenubarItem onClick={() => handleMenuAction('about')}>
                  About Fleet Manager
                </MenubarItem>
                <MenubarSeparator />
                <MenubarItem onClick={() => handleMenuAction('preferences')}>
                  Preferences <MenubarShortcut>⌘,</MenubarShortcut>
                </MenubarItem>
                <MenubarSeparator />
                <MenubarItem onClick={() => handleMenuAction('exit')}>
                  Log Out <MenubarShortcut>⌘Q</MenubarShortcut>
                </MenubarItem>
              </MenubarContent>
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
                  About Fleet Manager
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>
          </Menubar>
        </div>
        <div className="flex items-center gap-2 ml-2">
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="p-1 rounded-md hover:bg-accent/50 transition-colors"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4 text-foreground" />
            ) : (
              <Moon className="h-4 w-4 text-foreground" />
            )}
          </button>
          <span className="text-[10px] text-foreground">Battery: 100%</span>
          <span className="text-[10px] text-foreground">{new Date().toLocaleTimeString()}</span>
        </div>
      </div>
    </header>
  );
};