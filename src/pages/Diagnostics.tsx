
import { ScrollArea } from "@/components/ui/scroll-area";
import DiagnosticsHub from "@/components/diagnostics/DiagnosticsHub";

export const Diagnostics = () => {
  return (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="container mx-auto py-6 px-4 md:px-6 max-w-6xl">
        <DiagnosticsHub />
      </div>
    </ScrollArea>
  );
};

export default Diagnostics;
