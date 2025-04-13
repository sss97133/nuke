import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";


interface NewAuthLayoutProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function NewAuthLayout({ 
  title, 
  description, 
  children, 
  footer 
}: NewAuthLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center px-4 py-8 bg-gradient-to-br from-background to-secondary/10">
      <div className="w-full max-w-md space-y-6">
        {/* Logo and branding */}
        <div className="flex flex-col items-center space-y-2 mb-8">
          <div 
            className="flex items-center justify-center cursor-pointer"
            onClick={() => navigate('/')}
          >
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary font-bold">
              N
            </div>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Nuke</h1>
          <p className="text-sm text-muted-foreground">Vehicle-centric digital identity platform</p>
        </div>
        
        {/* Auth card */}
        <Card className="w-full shadow-lg border-muted/20">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-semibold text-center">{title}</CardTitle>
            {description && (
              <CardDescription className="text-center">{description}</CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {children}
          </CardContent>
          {footer && <CardFooter>{footer}</CardFooter>}
        </Card>
      </div>
    </div>
  );
}

export default NewAuthLayout;
