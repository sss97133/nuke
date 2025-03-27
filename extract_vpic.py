#!/usr/bin/env python3
import os
import re
import pandas as pd
from collections import defaultdict
import binascii
import sys

def extract_ascii_strings(file_path, min_length=3, max_chunk_size=10*1024*1024):
    """Extract ASCII strings from a binary file"""
    printable = set(b'0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~ \t\n\r')
    
    strings = []
    current_string = b""
    
    with open(file_path, 'rb') as f:
        while True:
            chunk = f.read(max_chunk_size)
            if not chunk:
                break
                
            for byte in chunk:
                byte_as_bytes = bytes([byte])
                if byte_as_bytes in printable:
                    current_string += byte_as_bytes
                elif len(current_string) >= min_length:
                    strings.append(current_string.decode('ascii', errors='ignore'))
                    current_string = b""
                else:
                    current_string = b""
    
    # Don't forget the last string
    if len(current_string) >= min_length:
        strings.append(current_string.decode('ascii', errors='ignore'))
    
    return strings

def find_vehicle_data(strings):
    """Find vehicle-related data in the extracted strings"""
    vehicle_data = defaultdict(list)
    
    # Pattern to match VINs (17 alphanumeric characters excluding I, O, and Q)
    vin_pattern = re.compile(r'[A-HJ-NPR-Z0-9]{17}')
    
    # Common car makes for filtering
    common_makes = [
        "ACURA", "ALFA ROMEO", "ASTON MARTIN", "AUDI", "BENTLEY", "BMW", "BUGATTI", 
        "BUICK", "CADILLAC", "CHEVROLET", "CHRYSLER", "DODGE", "FERRARI", "FIAT", 
        "FORD", "GENESIS", "GMC", "HONDA", "HYUNDAI", "INFINITI", "JAGUAR", "JEEP", 
        "KIA", "LAMBORGHINI", "LAND ROVER", "LEXUS", "LINCOLN", "LOTUS", "MASERATI", 
        "MAZDA", "MCLAREN", "MERCEDES-BENZ", "MINI", "MITSUBISHI", "NISSAN", "PORSCHE", 
        "RAM", "ROLLS-ROYCE", "SUBARU", "TESLA", "TOYOTA", "VOLKSWAGEN", "VOLVO"
    ]
    
    make_pattern = re.compile(r'(' + '|'.join(common_makes) + r')', re.IGNORECASE)
    
    # Process strings to find VINs and car makes
    for s in strings:
        # Look for VINs
        vins = vin_pattern.findall(s)
        for vin in vins:
            if is_valid_vin(vin):
                vehicle_data["VIN"].append(vin)
                vehicle_data["Context"].append(s[:100] + "..." if len(s) > 100 else s)
        
        # Look for car makes
        makes = make_pattern.findall(s)
        if makes:
            for make in makes:
                vehicle_data["Make"].append(make)
                vehicle_data["Context"].append(s[:100] + "..." if len(s) > 100 else s)
    
    return vehicle_data

def is_valid_vin(vin):
    """Basic validation of a VIN"""
    if len(vin) != 17:
        return False
    
    # VINs should not contain I, O, or Q
    if any(c in vin for c in "IOQ"):
        return False
    
    return True

def extract_model_year(context):
    """Try to extract model year from context"""
    year_pattern = re.compile(r'\b(19[7-9]\d|20[0-2]\d)\b')  # Years from 1970-2029
    matches = year_pattern.findall(context)
    return matches[0] if matches else None

def normalize_data(vehicle_data):
    """Normalize the extracted data into a structured format"""
    normalized = []
    
    # Create a set of unique VINs
    unique_vins = set(vehicle_data["VIN"])
    
    # For each unique VIN, find associated data
    for vin in unique_vins:
        vin_indices = [i for i, v in enumerate(vehicle_data["VIN"]) if v == vin]
        contexts = [vehicle_data["Context"][i] for i in vin_indices]
        
        # Try to find make and model from contexts
        make = None
        for context in contexts:
            for m in vehicle_data["Make"]:
                if m.upper() in context.upper():
                    make = m
                    break
            if make:
                break
        
        # Try to extract year
        year = None
        for context in contexts:
            extracted_year = extract_model_year(context)
            if extracted_year:
                year = extracted_year
                break
        
        normalized.append({
            "VIN": vin,
            "Make": make,
            "Year": year,
            "Context": contexts[0] if contexts else ""
        })
    
    return normalized

def main():
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <path_to_bak_file>")
        sys.exit(1)
    
    file_path = sys.argv[1]
    print(f"Extracting ASCII strings from {file_path}...")
    strings = extract_ascii_strings(file_path)
    print(f"Found {len(strings)} strings. Looking for vehicle data...")
    
    vehicle_data = find_vehicle_data(strings)
    print(f"Found {len(vehicle_data['VIN'])} potential VINs and {len(set(vehicle_data['Make']))} car makes.")
    
    normalized_data = normalize_data(vehicle_data)
    print(f"Normalized data contains {len(normalized_data)} unique vehicles.")
    
    # Create DataFrame and save to CSV
    df = pd.DataFrame(normalized_data)
    output_path = os.path.splitext(file_path)[0] + "_extracted.csv"
    df.to_csv(output_path, index=False)
    print(f"Data saved to {output_path}")
    
    # Print sample data
    print("\nSample of normalized data:")
    print(df.head(10))

if __name__ == "__main__":
    main()
