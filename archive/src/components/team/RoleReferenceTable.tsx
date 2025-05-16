
import React from 'react';
import { 
  Wrench, 
  Briefcase, 
  Building2, 
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
  Settings,
  Users
} from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type RoleCategory = 'technicians' | 'garages' | 'consultants' | 'partners' | 'media' | 'other';

interface RoleItem {
  icon: React.ReactNode;
  role: string;
  description: string;
}

interface RoleReferenceTableProps {
  category: string;
}

export const RoleReferenceTable = ({ category }: RoleReferenceTableProps) => {
  const roleData: Record<RoleCategory, RoleItem[]> = {
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

  const data = roleData[category as RoleCategory] || [];

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
