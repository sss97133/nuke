import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const departmentServiceTypes = {
  mechanical: [
    "engine_repair",
    "transmission_service",
    "brake_service",
    "suspension_work",
    "routine_maintenance",
    "diagnostics"
  ],
  bodywork: [
    "collision_repair",
    "paint_job",
    "dent_removal",
    "rust_repair",
    "panel_replacement",
    "frame_straightening"
  ],
  diagnostics: [
    "computer_diagnostics",
    "electrical_testing",
    "emissions_testing",
    "sensor_calibration",
    "performance_testing",
    "system_scanning"
  ],
  tires: [
    "tire_replacement",
    "tire_rotation",
    "wheel_alignment",
    "tire_balancing",
    "flat_repair",
    "tpms_service"
  ],
  detailing: [
    "exterior_detailing",
    "interior_detailing",
    "paint_correction",
    "ceramic_coating",
    "window_tinting",
    "protection_film"
  ],
  parts: [
    "parts_ordering",
    "parts_replacement",
    "inventory_check",
    "warranty_claims",
    "aftermarket_upgrades",
    "oem_replacement"
  ],
  specialty: [
    "performance_tuning",
    "custom_fabrication",
    "restoration",
    "ev_service",
    "hybrid_service",
    "classic_car_service"
  ],
  quick_service: [
    "oil_change",
    "filter_replacement",
    "fluid_top_off",
    "battery_service",
    "wiper_replacement",
    "bulb_replacement"
  ],
  metal_work: [
    "welding",
    "custom_fabrication",
    "roll_cage_installation",
    "exhaust_work",
    "structural_repair",
    "metal_forming"
  ],
  paint_and_body: [
    "custom_paint",
    "color_matching",
    "clear_coat",
    "vinyl_wrap",
    "pinstriping",
    "paint_protection"
  ],
  upholstery: [
    "seat_repair",
    "interior_restoration",
    "custom_upholstery",
    "convertible_top",
    "carpet_replacement",
    "headliner_repair"
  ],
  wiring: [
    "electrical_repair",
    "audio_installation",
    "lighting_upgrades",
    "security_systems",
    "diagnostic_systems",
    "custom_wiring"
  ]
};

interface ServiceDetailsProps {
  description: string;
  serviceType: string;
  selectedDepartment: string;
  onDescriptionChange: (value: string) => void;
  onServiceTypeChange: (value: string) => void;
}

export const ServiceDetails = ({
  description,
  serviceType,
  selectedDepartment,
  onDescriptionChange,
  onServiceTypeChange,
}: ServiceDetailsProps) => {
  const availableServiceTypes = selectedDepartment ? departmentServiceTypes[selectedDepartment as keyof typeof departmentServiceTypes] : [];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="serviceType">Service Type</Label>
        <Select 
          value={serviceType} 
          onValueChange={onServiceTypeChange}
          disabled={!selectedDepartment}
        >
          <SelectTrigger>
            <SelectValue placeholder={selectedDepartment ? "Select service type" : "Select department first"} />
          </SelectTrigger>
          <SelectContent>
            {availableServiceTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Describe the service needed..."
          className="min-h-[100px]"
        />
      </div>
    </div>
  );
};