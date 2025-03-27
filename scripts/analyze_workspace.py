#!/usr/bin/env python3
import torch
import json
import sys
import os
import argparse
from pathlib import Path
import numpy as np

def analyze_workspace(workspace_data, config):
    try:
        # Get model path from environment or default
        model_path = os.getenv('SPATIALLM_MODEL_PATH', '/models/spatiallm/model.pt')
        model_path = Path(model_path)

        # Load model
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        model = torch.load(model_path, map_location=device)
        model.eval()

        # Process workspace data
        dimensions = workspace_data['dimensions']
        cameras = workspace_data['cameras']

        # Generate point cloud from workspace dimensions
        point_cloud = generate_point_cloud(dimensions, config['pointCloudDensity'])

        # Analyze coverage
        coverage_score, blind_spots = analyze_coverage(
            model,
            point_cloud,
            cameras,
            config
        )

        # Prepare result
        result = {
            'coverageScore': float(coverage_score),
            'blindSpots': [
                {
                    'position': spot['position'],
                    'radius': float(spot['radius'])
                }
                for spot in blind_spots
            ],
            'cameras': cameras
        }

        print(json.dumps(result))
        return 0

    except Exception as e:
        error = {
            'status': 'error',
            'message': str(e)
        }
        print(json.dumps(error), file=sys.stderr)
        return 1

def generate_point_cloud(dimensions, density):
    # Generate a grid of points based on dimensions and density
    x = np.arange(0, dimensions['length'], density)
    y = np.arange(0, dimensions['width'], density)
    z = np.arange(0, dimensions['height'], density)
    
    xx, yy, zz = np.meshgrid(x, y, z)
    points = np.stack([xx.flatten(), yy.flatten(), zz.flatten()], axis=1)
    
    return torch.tensor(points, dtype=torch.float32)

def analyze_coverage(model, point_cloud, cameras, config):
    with torch.no_grad():
        # Process point cloud in batches
        batch_size = config['batchSize']
        coverage_scores = []
        blind_spots = []

        for i in range(0, len(point_cloud), batch_size):
            batch = point_cloud[i:i + batch_size]
            
            # Get model predictions
            predictions = model(batch)
            
            # Calculate coverage for this batch
            batch_coverage = calculate_batch_coverage(predictions, cameras)
            coverage_scores.append(batch_coverage)
            
            # Identify blind spots
            batch_blind_spots = identify_blind_spots(predictions, batch, cameras, config)
            blind_spots.extend(batch_blind_spots)

        # Calculate overall coverage
        overall_coverage = np.mean(coverage_scores)

        return overall_coverage, blind_spots

def calculate_batch_coverage(predictions, cameras):
    # Calculate how many points are covered by at least one camera
    covered_points = torch.zeros(len(predictions), dtype=torch.bool)
    
    for camera in cameras:
        # Calculate camera coverage for this batch
        camera_coverage = calculate_camera_coverage(predictions, camera)
        covered_points = covered_points | camera_coverage
    
    return float(torch.mean(covered_points.float()))

def calculate_camera_coverage(points, camera):
    # Calculate which points are within the camera's field of view
    camera_pos = torch.tensor(camera['position'], dtype=torch.float32)
    camera_rot = torch.tensor(camera['rotation'], dtype=torch.float32)
    fov = camera['fov']
    range_max = camera['range']
    
    # Calculate vectors from camera to points
    vectors = points - camera_pos
    
    # Calculate distances
    distances = torch.norm(vectors, dim=1)
    
    # Calculate angles from camera's forward direction
    forward = torch.tensor([0, 0, 1], dtype=torch.float32)
    angles = torch.acos(torch.clamp(
        torch.sum(vectors * forward, dim=1) / distances,
        -1.0, 1.0
    ))
    
    # Check if points are within FOV and range
    in_fov = angles <= (fov / 2)
    in_range = distances <= range_max
    
    return in_fov & in_range

def identify_blind_spots(predictions, points, cameras, config):
    # Identify areas with low coverage
    coverage = calculate_batch_coverage(predictions, cameras)
    
    if coverage < config['confidenceThreshold']:
        # Find the center of the blind spot
        blind_spot_center = torch.mean(points, dim=0)
        
        # Calculate radius based on point distribution
        distances = torch.norm(points - blind_spot_center, dim=1)
        radius = float(torch.mean(distances))
        
        return [{
            'position': {
                'x': float(blind_spot_center[0]),
                'y': float(blind_spot_center[1]),
                'z': float(blind_spot_center[2])
            },
            'radius': radius
        }]
    
    return []

def main():
    parser = argparse.ArgumentParser(description='Analyze workspace using SpatialLM')
    parser.add_argument('--workspace-data', type=str, required=True,
                      help='JSON string containing workspace data')
    parser.add_argument('--config', type=str, required=True,
                      help='JSON string containing configuration')
    
    args = parser.parse_args()
    
    try:
        workspace_data = json.loads(args.workspace_data)
        config = json.loads(args.config)
        sys.exit(analyze_workspace(workspace_data, config))
    except Exception as e:
        error = {
            'status': 'error',
            'message': str(e)
        }
        print(json.dumps(error), file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main() 