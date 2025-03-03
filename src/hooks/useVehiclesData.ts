import { useState } from 'react';
import { Vehicle, SortDirection, SortField } from '../components/vehicles/discovery/types';

export function useVehiclesData() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedVehicles, setSelectedVehicles] = useState<number[]>([]);
  const [bulkActionOpen, setBulkActionOpen] = useState(false);
  const [viewMode, setViewMode] = useState("grid");
  const [sortField, setSortField] = useState<SortField>("added");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  
  // Mock vehicle data - in a real app, this would likely come from an API
  const vehicles: Vehicle[] = [
    {
      id: 1,
      make: "Toyota",
      model: "Supra",
      year: 1998,
      price: 62500,
      market_value: 65000,
      price_trend: "up",
      mileage: 42000,
      image: "/placeholder.png",
      location: "Los Angeles, CA",
      added: "2 days ago",
      tags: ["Rare", "Sports Car"],
      condition_rating: 8,
      vehicle_type: "sports car",
      body_type: "Coupe",
      transmission: "Manual",
      drivetrain: "RWD",
      rarity_score: 7
    },
    {
      id: 2,
      make: "Ford",
      model: "Mustang",
      year: 1967,
      price: 78900,
      market_value: 80000,
      price_trend: "stable",
      mileage: 89000,
      image: "/placeholder.png",
      location: "Chicago, IL",
      added: "5 days ago",
      tags: ["Classic", "American"],
      condition_rating: 7,
      vehicle_type: "muscle car",
      body_type: "Coupe",
      transmission: "Manual",
      drivetrain: "RWD",
      era: "Classic",
      rarity_score: 6
    },
    {
      id: 3,
      make: "Honda",
      model: "Civic Type R",
      year: 2021,
      price: 42000,
      market_value: 40000,
      price_trend: "down",
      mileage: 12000,
      image: "/placeholder.png",
      location: "Seattle, WA",
      added: "1 week ago",
      tags: ["Hot Hatch", "Modified"],
      condition_rating: 9,
      vehicle_type: "hatchback",
      body_type: "Hatchback",
      transmission: "Manual",
      drivetrain: "FWD",
      restoration_status: "modified"
    },
    {
      id: 4,
      make: "Porsche",
      model: "911 Carrera",
      year: 2019,
      price: 110500,
      market_value: 115000,
      price_trend: "up",
      mileage: 18000,
      image: "/placeholder.png",
      location: "Miami, FL",
      added: "2 weeks ago",
      tags: ["Luxury", "Sports Car"],
      condition_rating: 10,
      vehicle_type: "sports car",
      body_type: "Coupe",
      transmission: "PDK",
      drivetrain: "AWD",
      special_edition: true
    },
    {
      id: 5,
      make: "Chevrolet",
      model: "Corvette",
      year: 2020,
      price: 86000,
      market_value: 86000,
      price_trend: "stable",
      mileage: 8500,
      image: "/placeholder.png",
      location: "Austin, TX",
      added: "3 days ago",
      tags: ["American", "Sports Car"],
      condition_rating: 9,
      vehicle_type: "sports car",
      body_type: "Coupe",
      transmission: "Automatic",
      drivetrain: "RWD"
    },
    {
      id: 6,
      make: "Nissan",
      model: "GT-R",
      year: 2017,
      price: 92000,
      market_value: 88000,
      price_trend: "down",
      mileage: 26000,
      image: "/placeholder.png",
      location: "Denver, CO",
      added: "6 days ago",
      tags: ["Japanese", "Performance"],
      condition_rating: 8,
      vehicle_type: "sports car",
      body_type: "Coupe",
      transmission: "Automatic",
      drivetrain: "AWD"
    }
  ];
  
  const handleVerify = (id: number) => {
    console.log(`Verifying vehicle ${id}`);
  };
  
  const handleEdit = (id: number) => {
    console.log(`Editing vehicle ${id}`);
  };
  
  const handleRemove = (id: number) => {
    console.log(`Removing vehicle ${id}`);
  };
  
  const toggleVehicleSelection = (id: number) => {
    if (id === -1) {
      setSelectedVehicles([]);
      return;
    }
    
    if (selectedVehicles.includes(id)) {
      setSelectedVehicles(selectedVehicles.filter(vehicleId => vehicleId !== id));
    } else {
      setSelectedVehicles([...selectedVehicles, id]);
    }
  };
  
  const handleBulkVerify = () => {
    console.log(`Verifying vehicles: ${selectedVehicles.join(', ')}`);
    setSelectedVehicles([]);
    setBulkActionOpen(false);
  };
  
  const handleBulkAddToGarage = () => {
    console.log(`Adding vehicles to garage: ${selectedVehicles.join(', ')}`);
    setSelectedVehicles([]);
    setBulkActionOpen(false);
  };
  
  const handleBulkRemove = () => {
    console.log(`Removing vehicles: ${selectedVehicles.join(', ')}`);
    setSelectedVehicles([]);
    setBulkActionOpen(false);
  };

  return {
    vehicles,
    searchTerm,
    setSearchTerm,
    selectedVehicles,
    setSelectedVehicles,
    bulkActionOpen,
    setBulkActionOpen,
    viewMode,
    setViewMode,
    sortField,
    setSortField,
    sortDirection,
    setSortDirection,
    handleVerify,
    handleEdit,
    handleRemove,
    toggleVehicleSelection,
    handleBulkVerify,
    handleBulkAddToGarage,
    handleBulkRemove
  };
}
