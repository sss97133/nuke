
import React, { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "next-themes";
import { handleProjectNavigation } from "../hooks/utils/navigationUtils";
import { SearchResults } from "./search/SearchResults";
import { UserMenu } from "./menu/UserMenu";

interface DashboardHeaderProps {
  handleMenuAction: (action: string) => void;
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({ handleMenuAction }) => {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const { toast } = useToast();

  const handleToggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      setOpen(!open);
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 't') {
      event.preventDefault();
      handleToggleTheme();
    }
  };

  const handleSearchSelect = (action: string) => {
    handleProjectNavigation(navigate, toast, action);
    setOpen(false);
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [theme]);

  return (
    <div className="border-b">
      <div className="flex h-16 items-center px-4">
        <div className="relative flex-1 max-w-lg">
          <Input
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Type a command or search..."
            className="w-full"
          />
          {open && searchValue && (
            <div className="absolute w-full mt-2 bg-white dark:bg-gray-800 rounded-md shadow-lg border">
              <SearchResults query={searchValue} handleSelect={handleSearchSelect} />
            </div>
          )}
        </div>

        <UserMenu 
          navigate={navigate}
          toast={toast}
          handleMenuAction={handleMenuAction}
        />
      </div>
    </div>
  );
};
