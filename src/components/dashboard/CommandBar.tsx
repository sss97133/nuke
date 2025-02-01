import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const CommandBar = () => {
  return (
    <div className="border border-gov-blue p-2 col-span-full">
      <div className="flex gap-2 items-center">
        <span className="text-tiny text-[#666]">CMD:</span>
        <Input
          placeholder="ENTER_COMMAND"
          className="h-7 text-tiny bg-white font-mono"
        />
        <Button
          size="sm"
          className="h-7 bg-[#283845] hover:bg-[#1a2830] text-white text-tiny"
        >
          EXEC
        </Button>
      </div>
    </div>
  );
};