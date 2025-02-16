
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Settings, Keyboard, HelpCircle, LogOut } from "lucide-react";
import { NavigateFunction } from "react-router-dom";
import { handleKeyboardShortcuts, handleProjectNavigation, handleSignOut } from "../../hooks/utils/navigationUtils";
import { ToastFunction } from "../../hooks/utils/types";

interface UserMenuProps {
  navigate: NavigateFunction;
  toast: ToastFunction;
  handleMenuAction: (action: string) => void;
}

export const UserMenu = ({ navigate, toast, handleMenuAction }: UserMenuProps) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="ml-2 h-8 w-8 p-0">
          <Avatar className="h-8 w-8">
            <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
            <AvatarFallback>CN</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>My Account</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => handleProjectNavigation(navigate, toast, 'preferences')}>
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleKeyboardShortcuts(toast)}>
          <Keyboard className="mr-2 h-4 w-4" />
          Keyboard Shortcuts
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleMenuAction('help')}>
          <HelpCircle className="mr-2 h-4 w-4" />
          Help
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => handleSignOut(navigate, toast)}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
