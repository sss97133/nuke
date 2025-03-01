
import { Menubar, MenubarMenu, MenubarTrigger } from "@/components/ui/menubar";
import { FileMenuItems, EditMenuItems, ViewMenuItems } from "./menu/MenuItems";
import { ToolsMenuItems, WindowMenuItems, HelpMenuItems } from "./menu/MoreMenuItems";

interface MainMenuProps {
  handleMenuAction: (action: string) => void;
}

export const MainMenu = ({ handleMenuAction }: MainMenuProps) => {
  return (
    <div className="flex items-center">
      <div className="flex items-center">
        <Menubar className="border-none bg-transparent py-0">
          <MenubarMenu>
            <MenubarTrigger className="text-[11px]">File</MenubarTrigger>
            <FileMenuItems handleMenuAction={handleMenuAction} />
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="text-[11px]">Edit</MenubarTrigger>
            <EditMenuItems handleMenuAction={handleMenuAction} />
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="text-[11px]">View</MenubarTrigger>
            <ViewMenuItems handleMenuAction={handleMenuAction} />
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="text-[11px]">Tools</MenubarTrigger>
            <ToolsMenuItems handleMenuAction={handleMenuAction} />
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="text-[11px]">Window</MenubarTrigger>
            <WindowMenuItems handleMenuAction={handleMenuAction} />
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="text-[11px]">Help</MenubarTrigger>
            <HelpMenuItems handleMenuAction={handleMenuAction} />
          </MenubarMenu>
        </Menubar>
      </div>
    </div>
  );
};
