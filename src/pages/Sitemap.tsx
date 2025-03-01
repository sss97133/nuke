
import React from 'react';
import { Map, Layout, Navigation, ExternalLink, Home, Compass, Code, FileText, Upload, Car, User } from 'lucide-react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Link } from 'react-router-dom';

const SitemapItem = ({ 
  icon: Icon, 
  title, 
  description, 
  path 
}: { 
  icon: React.ElementType; 
  title: string; 
  description: string; 
  path: string 
}) => (
  <Link to={path} className="block">
    <Card className="p-4 hover:bg-muted/50 transition-colors">
      <div className="flex items-start gap-3">
        <div className="bg-primary/10 p-2 rounded-md">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h3 className="font-medium">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </Card>
  </Link>
);

const Sitemap = () => {
  const sitemapSections = [
    {
      title: "Main Navigation",
      items: [
        {
          icon: Home,
          title: "Dashboard",
          description: "Main overview of your activities and status",
          path: "/dashboard"
        },
        {
          icon: Layout,
          title: "Onboarding",
          description: "Get started with the platform",
          path: "/onboarding"
        },
        {
          icon: Compass,
          title: "Skills",
          description: "Manage and develop your skills",
          path: "/skills"
        },
        {
          icon: ExternalLink,
          title: "Achievements",
          description: "View your earned achievements",
          path: "/achievements"
        }
      ]
    },
    {
      title: "Tools & Resources",
      items: [
        {
          icon: Layout,
          title: "Studio",
          description: "Media production studio tools",
          path: "/studio"
        },
        {
          icon: FileText,
          title: "Glossary",
          description: "Definitions of industry terms",
          path: "/glossary"
        },
        {
          icon: Code,
          title: "Documentation",
          description: "Technical documentation and guides",
          path: "/documentation"
        }
      ]
    },
    {
      title: "Data Management",
      items: [
        {
          icon: Upload,
          title: "Import",
          description: "Import data from external sources",
          path: "/import"
        },
        {
          icon: Car,
          title: "Discovered Vehicles",
          description: "Browse vehicles discovered in the system",
          path: "/discovered-vehicles"
        },
        {
          icon: User,
          title: "Profile",
          description: "Manage your user profile",
          path: "/profile"
        }
      ]
    }
  ];

  return (
    <ScrollArea className="h-[calc(100vh-4rem)] p-4">
      <div className="container max-w-5xl py-6 space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">Sitemap</h1>
          <p className="text-muted-foreground">
            Navigate to different sections of the application
          </p>
        </div>

        {sitemapSections.map((section, index) => (
          <div key={index} className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">{section.title}</h2>
              <Separator className="mt-2" />
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {section.items.map((item, itemIndex) => (
                <SitemapItem
                  key={itemIndex}
                  icon={item.icon}
                  title={item.title}
                  description={item.description}
                  path={item.path}
                />
              ))}
            </div>
          </div>
        ))}
        
        <div className="pt-4 text-center text-sm text-muted-foreground">
          <p>Can't find what you're looking for? Try using the search function in the dashboard.</p>
        </div>
      </div>
    </ScrollArea>
  );
};

export default Sitemap;
