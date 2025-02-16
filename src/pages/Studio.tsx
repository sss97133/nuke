
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";

export const Studio = () => {
  return (
    <ScrollArea className="h-[calc(100vh-4rem)] p-4">
      <div className="space-y-4">
        <h1 className="text-2xl font-bold mb-4">Studio</h1>
        <Card className="p-4">
          <p className="text-muted-foreground">Studio content coming soon...</p>
        </Card>
      </div>
    </ScrollArea>
  );
};

export default Studio;
