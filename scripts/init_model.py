#!/usr/bin/env python3
import torch
import json
import sys
import os
from pathlib import Path

def init_model():
    try:
        # Get model path from environment or default
        model_path = os.getenv('SPATIALLM_MODEL_PATH', '/models/spatiallm/model.pt')
        model_path = Path(model_path)

        # Verify model file exists
        if not model_path.exists():
            raise FileNotFoundError(f"Model file not found at {model_path}")

        # Load model configuration
        config_path = model_path.parent / 'config.json'
        if not config_path.exists():
            raise FileNotFoundError(f"Model configuration not found at {config_path}")

        with open(config_path) as f:
            config = json.load(f)

        # Initialize model
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        model = torch.load(model_path, map_location=device)
        model.eval()

        # Save initialization status
        status = {
            'status': 'success',
            'device': str(device),
            'model_path': str(model_path),
            'config': config
        }
        print(json.dumps(status))
        return 0

    except Exception as e:
        error = {
            'status': 'error',
            'message': str(e)
        }
        print(json.dumps(error), file=sys.stderr)
        return 1

if __name__ == '__main__':
    sys.exit(init_model()) 