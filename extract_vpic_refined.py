#!/usr/bin/env python3
import os
import sys
import re
import pandas as pd
import json
from collections import defaultdict

def read_chunks(file_path, chunk_size=10*1024*1024):
    """Read the file in chunks to handle large files"""
    with open(file_path, 'rb') as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            yield chunk

def extract_vpic_data(file_path):
    """Extract VPIC data from the file"""
    print(f"Processing {file_path}...")
    
    # Regular expressions for VPIC data
    # Pattern for valid VINs (17 chars, no I,O,Q)
    vin_pattern = re.compile(b'[A-HJ-NPR-Z0-9]{17}')
    
    # Lists of common manufacturers and models for pattern matching
    manufacturers = [
        b'AUDI', b'BMW', b'BUICK', b'CADILLAC', b'CHEVROLET', b'CHRYSLER', b'DODGE', 
        b'FORD', b'GMC', b'HONDA', b'HYUNDAI', b'INFINITI', b'JAGUAR', b'JEEP', b'KIA',
        b'LAND ROVER', b'LEXUS', b'LINCOLN', b'MAZDA', b'MERCEDES-BENZ', b'MERCURY',
        b'MINI', b'MITSUBISHI', b'NISSAN', b'PONTIAC', b'PORSCHE', b'RAM', b'SAAB', 
        b'SATURN', b'SCION', b'SUBARU', b'TESLA', b'TOYOTA', b'VOLKSWAGEN', b'VOLVO'
    ]
    
    # Compiled regex for manufacturers
    manufacturer_pattern = re.compile(b'(' + b'|'.join(manufacturers) + b')', re.IGNORECASE)
    
    # Storage for extracted data
    vehicle_data = []
    unique_vins = set()
    
    # Process file in chunks
    for i, chunk in enumerate(read_chunks(file_path)):
        if i % 10 == 0:
            print(f"Processing chunk {i}...")
        
        # Find all VINs in chunk
        vins = vin_pattern.findall(chunk)
        
        for vin in vins:
            try:
                vin_str = vin.decode('utf-8')
                
                # Skip if we've already processed this VIN
                if vin_str in unique_vins:
                    continue
                
                unique_vins.add(vin_str)
                
                # Find the context around the VIN (up to 500 bytes)
                vin_pos = chunk.find(vin)
                start_pos = max(0, vin_pos - 250)
                end_pos = min(len(chunk), vin_pos + 250)
                context = chunk[start_pos:end_pos]
                
                # Try to find manufacturer in context
                make_match = manufacturer_pattern.search(context)
                make = make_match.group(1).decode('utf-8') if make_match else None
                
                # Try to find model year in context (4 digit number between 1970-2025)
                year_match = re.search(b'(19[7-9][0-9]|20[0-2][0-5])', context)
                year = year_match.group(1).decode('utf-8') if year_match else None
                
                # Extract model (more complex, between make and year or near them)
                model = None
                if make and year:
                    context_str = context.decode('utf-8', errors='ignore')
                    # Look for text between manufacturer and year
                    make_pos = context_str.upper().find(make.upper())
                    year_pos = context_str.find(year)
                    
                    if make_pos < year_pos:
                        # Model might be between make and year
                        model_section = context_str[make_pos + len(make):year_pos].strip()
                        model_words = re.findall(r'\b[A-Z][A-Za-z0-9-]{2,}\b', model_section)
                        if model_words:
                            model = model_words[0]
                
                vehicle_data.append({
                    "VIN": vin_str,
                    "Make": make,
                    "Model": model,
                    "Year": year,
                    "Context": context.decode('utf-8', errors='ignore')
                })
                
                # Limit the data to avoid memory issues
                if len(vehicle_data) >= 5000:
                    break
            except Exception as e:
                # Skip entries that cause errors
                continue
        
        # Break after we've found enough data
        if len(vehicle_data) >= 5000:
            print(f"Reached limit of 5000 vehicle records")
            break
    
    print(f"Extracted {len(vehicle_data)} vehicle records")
    return vehicle_data

def find_real_vehicles(vehicle_data):
    """Filter for real vehicles by validating VINs and checking for make/model/year"""
    filtered_data = []
    
    for vehicle in vehicle_data:
        vin = vehicle["VIN"]
        
        # Simple VIN validation check for known patterns
        # 1st char should be letter or number representing country
        # 10th char should be a letter (A-Z except I,O,Q) or digit representing year
        # Check for common patterns that indicate this is a real VIN
        valid_vin = (
            len(vin) == 17 and
            not any(c in "IOQ" for c in vin) and
            (vin[0].isalpha() or vin[0].isdigit()) and
            (vin[9].isalpha() or vin[9].isdigit())
        )
        
        # Check if we have at least one of make, model, or year
        has_metadata = vehicle["Make"] or vehicle["Model"] or vehicle["Year"]
        
        if valid_vin and has_metadata:
            filtered_data.append(vehicle)
    
    print(f"Found {len(filtered_data)} likely real vehicles")
    return filtered_data

def normalize_data(vehicle_data):
    """Normalize the vehicle data, remove duplicates and clean up"""
    normalized = []
    seen_vins = set()
    
    for vehicle in vehicle_data:
        if vehicle["VIN"] in seen_vins:
            continue
            
        seen_vins.add(vehicle["VIN"])
        
        # Clean up make
        if vehicle["Make"]:
            vehicle["Make"] = vehicle["Make"].strip().upper()
        
        # Clean up model
        if vehicle["Model"]:
            vehicle["Model"] = vehicle["Model"].strip().title()
        
        # Clean up context (truncate and remove non-printable chars)
        if vehicle["Context"]:
            # Keep only printable ASCII characters
            clean_context = ''.join(c for c in vehicle["Context"] if c.isprintable() or c.isspace())
            vehicle["Context"] = clean_context[:100] + "..." if len(clean_context) > 100 else clean_context
        
        normalized.append(vehicle)
    
    return normalized

def main():
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <path_to_bak_file>")
        sys.exit(1)
    
    file_path = sys.argv[1]
    
    # Extract data
    vehicle_data = extract_vpic_data(file_path)
    
    # Filter for real vehicles
    filtered_data = find_real_vehicles(vehicle_data)
    
    # Normalize the data
    normalized_data = normalize_data(filtered_data)
    
    # Save to CSV
    output_csv = os.path.splitext(file_path)[0] + "_normalized.csv"
    df = pd.DataFrame(normalized_data)
    df.to_csv(output_csv, index=False)
    print(f"Normalized data saved to {output_csv}")
    
    # Print sample
    print("\nSample of normalized data:")
    if len(df) > 0:
        print(df.head(10).to_string())
    else:
        print("No data found")

if __name__ == "__main__":
    main()
