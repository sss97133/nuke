
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { BookOpen } from "lucide-react";
import { DocumentationDialog } from "./DocumentationDialog";

interface DocumentationButtonProps {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  showIcon?: boolean;
}

export const DocumentationButton = ({ 
  variant = "outline", 
  size = "default",
  showIcon = true 
}: DocumentationButtonProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <Button 
        variant={variant} 
        size={size} 
        onClick={() => setDialogOpen(true)}
      >
        {showIcon && <BookOpen className="h-4 w-4 mr-2" />}
        Documentation
      </Button>
      
      <DocumentationDialog 
        open={dialogOpen} 
        onOpenChange={setDialogOpen} 
      />
    </>
  );
};
