#!/usr/bin/env python3
import sys
import re
import os
import json
import pandas as pd
from collections import defaultdict

def extract_table_structures(file_path, max_chunk_size=10*1024*1024):
    """Try to extract table structures from SQL Server .bak file"""
    results = {
        "tables": [],
        "create_statements": [],
        "data_chunks": []
    }
    
    # Regular expressions to find table names and create statements
    table_pattern = re.compile(rb'CREATE\s+TABLE\s+\[?(\w+)\]?', re.IGNORECASE)
    create_stmt_pattern = re.compile(rb'CREATE\s+TABLE.*?\);', re.DOTALL | re.IGNORECASE)
    
    with open(file_path, 'rb') as f:
        position = 0
        while True:
            f.seek(position)
            chunk = f.read(max_chunk_size)
            if not chunk:
                break
                
            # Look for table names
            tables = table_pattern.findall(chunk)
            for table in tables:
                try:
                    table_name = table.decode('utf-8', errors='ignore')
                    if table_name not in results["tables"]:
                        results["tables"].append(table_name)
                except:
                    pass
            
            # Look for create statements
            create_stmts = create_stmt_pattern.findall(chunk)
            for stmt in create_stmts:
                try:
                    stmt_str = stmt.decode('utf-8', errors='ignore')
                    results["create_statements"].append(stmt_str)
                except:
                    pass
            
            # Extract potential data chunks (rows of data)
            # This is a bit more complex as we need to look for patterns in the data
            data_chunks = extract_data_rows(chunk.decode('utf-8', errors='ignore'))
            results["data_chunks"].extend(data_chunks)
            
            position += max_chunk_size - 1000  # Overlap chunks to avoid missing things at boundaries
    
    return results

def extract_data_rows(text):
    """Try to extract rows of data that might represent vehicle information"""
    data_chunks = []
    
    # Look for potential VIN patterns
    vin_pattern = re.compile(r'[A-HJ-NPR-Z0-9]{17}')
    vin_matches = vin_pattern.finditer(text)
    
    for match in vin_matches:
        start = max(0, match.start() - 100)
        end = min(len(text), match.end() + 100)
        chunk = text[start:end]
        data_chunks.append(chunk)
    
    # Look for common car makes
    common_makes = [
        "ACURA", "ALFA", "ASTON", "AUDI", "BENTLEY", "BMW", "BUGATTI", 
        "BUICK", "CADILLAC", "CHEVROLET", "CHRYSLER", "DODGE", "FERRARI", "FIAT", 
        "FORD", "GENESIS", "GMC", "HONDA", "HYUNDAI", "INFINITI", "JAGUAR", "JEEP", 
        "KIA", "LAMBORGHINI", "ROVER", "LEXUS", "LINCOLN", "LOTUS", "MASERATI", 
        "MAZDA", "MCLAREN", "MERCEDES", "MINI", "MITSUBISHI", "NISSAN", "PORSCHE", 
        "RAM", "ROLLS", "SUBARU", "TESLA", "TOYOTA", "VOLKSWAGEN", "VOLVO"
    ]
    
    for make in common_makes:
        pattern = re.compile(r'\b' + make + r'\b', re.IGNORECASE)
        for match in pattern.finditer(text):
            start = max(0, match.start() - 50)
            end = min(len(text), match.end() + 150)
            chunk = text[start:end]
            data_chunks.append(chunk)
    
    return data_chunks

def parse_vpic_data(data_chunks):
    """Try to extract and structure vehicle data from chunks"""
    vehicle_data = []
    
    # Pattern for VINs
    vin_pattern = re.compile(r'[A-HJ-NPR-Z0-9]{17}')
    
    # Pattern for common delimiters in data
    delimiter_pattern = re.compile(r'[\t,;|]')
    
    for chunk in data_chunks:
        # If chunk contains a VIN
        vins = vin_pattern.findall(chunk)
        if not vins:
            continue
            
        for vin in vins:
            # Skip invalid VINs (containing I, O, Q)
            if any(c in vin for c in "IOQ"):
                continue
                
            # Try to find make/model/year near the VIN
            # Split the chunk by common delimiters
            parts = re.split(delimiter_pattern, chunk)
            parts = [p.strip() for p in parts if p.strip()]
            
            # Find the part containing the VIN
            vin_index = -1
            for i, part in enumerate(parts):
                if vin in part:
                    vin_index = i
                    break
            
            if vin_index == -1:
                continue
                
            # Try to extract make, model, year
            make = model = year = None
            
            # Look for year (19xx or 20xx)
            year_pattern = re.compile(r'\b(19[7-9][0-9]|20[0-2][0-9])\b')
            for part in parts:
                match = year_pattern.search(part)
                if match:
                    year = match.group(1)
                    break
            
            # Common car makes
            common_makes = [
                "ACURA", "ALFA ROMEO", "ASTON MARTIN", "AUDI", "BENTLEY", "BMW", "BUGATTI", 
                "BUICK", "CADILLAC", "CHEVROLET", "CHRYSLER", "DODGE", "FERRARI", "FIAT", 
                "FORD", "GENESIS", "GMC", "HONDA", "HYUNDAI", "INFINITI", "JAGUAR", "JEEP", 
                "KIA", "LAMBORGHINI", "LAND ROVER", "LEXUS", "LINCOLN", "LOTUS", "MASERATI", 
                "MAZDA", "MCLAREN", "MERCEDES", "MINI", "MITSUBISHI", "NISSAN", "PORSCHE", 
                "RAM", "ROLLS-ROYCE", "SUBARU", "TESLA", "TOYOTA", "VOLKSWAGEN", "VOLVO"
            ]
            
            for part in parts:
                for car_make in common_makes:
                    if car_make.upper() in part.upper():
                        make = car_make
                        # Try to find model - it's often right after the make
                        remaining = part.upper().split(car_make.upper(), 1)[-1].strip()
                        if remaining:
                            model = remaining
                        break
                if make:
                    break
            
            vehicle_data.append({
                "VIN": vin,
                "Make": make,
                "Model": model,
                "Year": year,
                "Context": chunk[:200] + "..." if len(chunk) > 200 else chunk
            })
    
    # Remove duplicates based on VIN
    seen_vins = set()
    unique_data = []
    for item in vehicle_data:
        if item["VIN"] not in seen_vins:
            seen_vins.add(item["VIN"])
            unique_data.append(item)
    
    return unique_data

def main():
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <path_to_bak_file>")
        sys.exit(1)
    
    file_path = sys.argv[1]
    print(f"Analyzing {file_path}...")
    
    # Extract information from the file
    results = extract_table_structures(file_path)
    
    print(f"Found {len(results['tables'])} potential table names")
    if results['tables']:
        print("Tables:", results['tables'][:10])
    
    print(f"Found {len(results['create_statements'])} potential CREATE statements")
    if results['create_statements']:
        print("Sample CREATE statement:", results['create_statements'][0][:200] + "..." if len(results['create_statements'][0]) > 200 else results['create_statements'][0])
    
    print(f"Found {len(results['data_chunks'])} potential data chunks")
    
    # Parse the data chunks to extract vehicle info
    vehicle_data = parse_vpic_data(results['data_chunks'])
    print(f"Extracted {len(vehicle_data)} potential vehicle records")
    
    # Save the extracted data
    output_csv = os.path.splitext(file_path)[0] + "_vehicles.csv"
    if vehicle_data:
        df = pd.DataFrame(vehicle_data)
        df.to_csv(output_csv, index=False)
        print(f"Vehicle data saved to {output_csv}")
        
        # Print sample
        print("\nSample data:")
        print(df.head(5).to_string())
    
    # Save all extraction results
    output_json = os.path.splitext(file_path)[0] + "_analysis.json"
    with open(output_json, 'w') as f:
        # Convert binary data to strings for JSON
        clean_results = {
            "tables": results["tables"],
            "create_statements": results["create_statements"][:5],  # Limit to 5 to avoid huge file
            "data_chunks_count": len(results["data_chunks"]),
            "sample_data_chunks": results["data_chunks"][:5] if results["data_chunks"] else []
        }
        json.dump(clean_results, f, indent=2)
    
    print(f"Full analysis saved to {output_json}")

if __name__ == "__main__":
    main()
