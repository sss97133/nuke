import React, { useState } from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TeamSection } from '@/components/profile/TeamSection';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Users, 
  Briefcase, 
  Building2, 
  Wrench, 
  UserPlus, 
  Brush, 
  Truck, 
  Hammer, 
  Award, 
  Video, 
  Coins, 
  Database,
  Warehouse,
  PenTool,
  HardHat,
  Laptop,
  Car,
  ClipboardCheck,
  Settings
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const TeamMembers = () => {
  const [selectedCategory, setSelectedCategory] = useState('all');

  return (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="container max-w-7xl mx-auto py-6 px-4 space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Team Members</h1>
            <p className="text-muted-foreground">Manage your network of professionals and collaborators</p>
          </div>
          <Button>
            <UserPlus className="h-4 w-4 mr-2" />
            Add Team Member
          </Button>
        </div>
        
        <Tabs defaultValue="all" onValueChange={setSelectedCategory}>
          <TabsList className="mb-4 flex flex-wrap h-auto">
            <TabsTrigger value="all">All Members</TabsTrigger>
            <TabsTrigger value="technicians">Technicians</TabsTrigger>
            <TabsTrigger value="garages">Service Businesses</TabsTrigger>
            <TabsTrigger value="consultants">Consultants</TabsTrigger>
            <TabsTrigger value="partners">Business Partners</TabsTrigger>
            <TabsTrigger value="media">Media & Documentation</TabsTrigger>
            <TabsTrigger value="other">Other</TabsTrigger>
          </TabsList>
          
          <TabsContent value="all" className="space-y-4">
            <TeamSection />
          </TabsContent>
          
          <TabsContent value="technicians" className="space-y-4">
            <TechniciansList />
          </TabsContent>
          
          <TabsContent value="garages" className="space-y-4">
            <ServiceBusinessesList />
          </TabsContent>
          
          <TabsContent value="consultants" className="space-y-4">
            <ConsultantsList />
          </TabsContent>
          
          <TabsContent value="partners" className="space-y-4">
            <BusinessPartnersList />
          </TabsContent>
          
          <TabsContent value="media" className="space-y-4">
            <MediaList />
          </TabsContent>
          
          <TabsContent value="other" className="space-y-4">
            <OtherMembersList />
          </TabsContent>
        </Tabs>

        {selectedCategory !== 'all' && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Category Reference Guide</CardTitle>
              <CardDescription>
                Standard roles that fall under the {selectedCategory} category
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RoleReferenceTable category={selectedCategory} />
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
};

const TechniciansList = () => (
  <Card>
    <CardHeader>
      <div className="flex items-center gap-2">
        <Wrench className="h-5 w-5 text-primary" />
        <CardTitle>Technicians</CardTitle>
      </div>
      <CardDescription>Professionals who service your vehicles</CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-muted-foreground">No technicians added yet. Add technicians to track service history and schedule maintenance.</p>
    </CardContent>
  </Card>
);

const ServiceBusinessesList = () => (
  <Card>
    <CardHeader>
      <div className="flex items-center gap-2">
        <Building2 className="h-5 w-5 text-primary" />
        <CardTitle>Service Businesses</CardTitle>
      </div>
      <CardDescription>Service centers, repair shops, and specialized vendors you work with</CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-muted-foreground">No service businesses added yet. Connect with garages and service providers to streamline your vehicle maintenance.</p>
    </CardContent>
  </Card>
);

const ConsultantsList = () => (
  <Card>
    <CardHeader>
      <div className="flex items-center gap-2">
        <Briefcase className="h-5 w-5 text-primary" />
        <CardTitle>Consultants</CardTitle>
      </div>
      <CardDescription>Advisors and specialists for vehicle projects</CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-muted-foreground">No consultants added yet. Add specialized professionals to enhance your projects.</p>
    </CardContent>
  </Card>
);

const BusinessPartnersList = () => (
  <Card>
    <CardHeader>
      <div className="flex items-center gap-2">
        <Coins className="h-5 w-5 text-primary" />
        <CardTitle>Business Partners</CardTitle>
      </div>
      <CardDescription>Suppliers, vendors, and service providers for your operations</CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-muted-foreground">No business partners added yet. Add parts suppliers, vendors, and other business connections.</p>
    </CardContent>
  </Card>
);

const MediaList = () => (
  <Card>
    <CardHeader>
      <div className="flex items-center gap-2">
        <Video className="h-5 w-5 text-primary" />
        <CardTitle>Media & Documentation</CardTitle>
      </div>
      <CardDescription>Content creators and documentation specialists</CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-muted-foreground">No media team members added yet. Add photographers, videographers, and other content specialists.</p>
    </CardContent>
  </Card>
);

const OtherMembersList = () => (
  <Card>
    <CardHeader>
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-primary" />
        <CardTitle>Other Members</CardTitle>
      </div>
      <CardDescription>Additional team members and collaborators</CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-muted-foreground">No other team members added yet.</p>
    </CardContent>
  </Card>
);

const RoleReferenceTable = ({ category }: { category: string }) => {
  const roleData = {
    technicians: [
      { icon: <Wrench className="h-4 w-4" />, role: 'General Mechanic', description: 'All-around vehicle service and repair' },
      { icon: <Laptop className="h-4 w-4" />, role: 'Diagnostic Specialist', description: 'Specializes in computerized diagnostics' },
      { icon: <Hammer className="h-4 w-4" />, role: 'Restoration Expert', description: 'Specialized in vintage/classic vehicle restoration' },
      { icon: <PenTool className="h-4 w-4" />, role: 'Custom Fabricator', description: 'Creates custom parts and modifications' },
      { icon: <Car className="h-4 w-4" />, role: 'Performance Tuner', description: 'Specializes in performance optimization' },
      { icon: <Brush className="h-4 w-4" />, role: 'Paint/Body Specialist', description: 'Bodywork and finishing expert' },
      { icon: <Settings className="h-4 w-4" />, role: 'Specialty Technician', description: 'Focused on specific systems (transmission, electrical, etc.)' }
    ],
    garages: [
      { icon: <Building2 className="h-4 w-4" />, role: 'Independent Garage', description: 'Small to medium-sized repair shop' },
      { icon: <Car className="h-4 w-4" />, role: 'Dealership Service', description: 'Manufacturer-affiliated service center' },
      { icon: <Wrench className="h-4 w-4" />, role: 'Specialty Shop', description: 'Focused on specific repairs (transmission, electrical, etc.)' },
      { icon: <Truck className="h-4 w-4" />, role: 'Mobile Service', description: 'On-location repair and maintenance' },
      { icon: <Brush className="h-4 w-4" />, role: 'Detailing Service', description: 'Appearance and protection specialists' },
      { icon: <HardHat className="h-4 w-4" />, role: 'Collision Center', description: 'Accident repair and body shop' }
    ],
    consultants: [
      { icon: <Award className="h-4 w-4" />, role: 'Vehicle Appraiser', description: 'Expert in vehicle valuation' },
      { icon: <ClipboardCheck className="h-4 w-4" />, role: 'Project Manager', description: 'Oversees complex restoration or build projects' },
      { icon: <Briefcase className="h-4 w-4" />, role: 'Automotive Engineer', description: 'Technical design and problem-solving' },
      { icon: <PenTool className="h-4 w-4" />, role: 'Design Consultant', description: 'Custom design and aesthetic planning' },
      { icon: <Car className="h-4 w-4" />, role: 'Classic Car Expert', description: 'Specialist in vintage vehicle knowledge' }
    ],
    partners: [
      { icon: <Warehouse className="h-4 w-4" />, role: 'Parts Supplier', description: 'Provides OEM or aftermarket parts' },
      { icon: <Wrench className="h-4 w-4" />, role: 'Tool Vendor', description: 'Specialized tools and equipment' },
      { icon: <Coins className="h-4 w-4" />, role: 'Financial Partner', description: 'Insurance, financing, or investment services' },
      { icon: <Truck className="h-4 w-4" />, role: 'Transport Provider', description: 'Vehicle transportation and logistics' },
      { icon: <Database className="h-4 w-4" />, role: 'Software Partner', description: 'Tech and software solutions' }
    ],
    media: [
      { icon: <Video className="h-4 w-4" />, role: 'Photographer', description: 'Professional vehicle photography' },
      { icon: <Video className="h-4 w-4" />, role: 'Videographer', description: 'Video content creation' },
      { icon: <Laptop className="h-4 w-4" />, role: 'Content Creator', description: 'Blog, social media, and content management' },
      { icon: <Briefcase className="h-4 w-4" />, role: 'Technical Writer', description: 'Documentation and manual creation' }
    ],
    other: [
      { icon: <Users className="h-4 w-4" />, role: 'Apprentice', description: 'Learning the trade under supervision' },
      { icon: <Award className="h-4 w-4" />, role: 'Mentor', description: 'Provides guidance and expertise' },
      { icon: <Users className="h-4 w-4" />, role: 'Club Member', description: 'Part of a vehicle enthusiast group' }
    ]
  };

  const data = roleData[category as keyof typeof roleData] || [];

  if (data.length === 0) return null;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[50px]"></TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Description</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((item, index) => (
          <TableRow key={index}>
            <TableCell>{item.icon}</TableCell>
            <TableCell className="font-medium">{item.role}</TableCell>
            <TableCell>{item.description}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export default TeamMembers;
