#!/usr/bin/env python3

import argparse
import json
import numpy as np
import torch
from PIL import Image
import sys
from pathlib import Path

# Add SpatialLM to Python path
spatiallm_path = Path(__file__).parent.parent / 'SpatialLM'
sys.path.append(str(spatiallm_path))

from spatiallm import SpatialLM, process_image

def parse_args():
    parser = argparse.ArgumentParser(description='Process workspace image using SpatialLM')
    parser.add_argument('--image', required=True, help='Path to input image')
    parser.add_argument('--model', required=True, help='Path to SpatialLM model')
    parser.add_argument('--output', choices=['json', 'ply'], default='json',
                      help='Output format (default: json)')
    return parser.parse_args()

def main():
    args = parse_args()
    
    try:
        # Load and preprocess image
        image = Image.open(args.image)
        image = image.convert('RGB')
        
        # Initialize SpatialLM model
        model = SpatialLM(model_path=args.model)
        
        # Process image
        point_cloud, objects = process_image(model, image)
        
        # Convert results to JSON format
        result = {
            'pointCloud': point_cloud.tolist(),
            'dimensions': {
                'length': float(np.max(point_cloud[:, 0]) - np.min(point_cloud[:, 0])),
                'width': float(np.max(point_cloud[:, 1]) - np.min(point_cloud[:, 1])),
                'height': float(np.max(point_cloud[:, 2]) - np.min(point_cloud[:, 2]))
            },
            'objects': [
                {
                    'type': obj['type'],
                    'position': {
                        'x': float(obj['position'][0]),
                        'y': float(obj['position'][1]),
                        'z': float(obj['position'][2])
                    },
                    'dimensions': {
                        'length': float(obj['dimensions'][0]),
                        'width': float(obj['dimensions'][1]),
                        'height': float(obj['dimensions'][2])
                    }
                }
                for obj in objects
            ]
        }
        
        # Output results
        if args.output == 'json':
            print(json.dumps(result))
        else:  # ply
            # Save point cloud as PLY file
            output_path = Path(args.image).with_suffix('.ply')
            save_point_cloud_ply(point_cloud, output_path)
            print(f"Point cloud saved to {output_path}")
            
    except Exception as e:
        print(f"Error: {str(e)}", file=sys.stderr)
        sys.exit(1)

def save_point_cloud_ply(points, output_path):
    """Save point cloud to PLY format"""
    with open(output_path, 'w') as f:
        # Write header
        f.write("ply\n")
        f.write("format ascii 1.0\n")
        f.write(f"element vertex {len(points)}\n")
        f.write("property float x\n")
        f.write("property float y\n")
        f.write("property float z\n")
        f.write("end_header\n")
        
        # Write points
        for point in points:
            f.write(f"{point[0]} {point[1]} {point[2]}\n")

if __name__ == '__main__':
    main() 