#!/bin/bash

# Exit on error
set -e

echo "Setting up SpatialLM environment..."

# Create and activate conda environment
conda create -n spatiallm python=3.11 -y
conda activate spatiallm

# Install CUDA toolkit
conda install -c nvidia cuda-toolkit=12.4 -y

# Install sparsehash
conda install -c conda-forge sparsehash -y

# Install Poetry
curl -sSL https://install.python-poetry.org | python3 -

# Clone SpatialLM repository
git clone https://github.com/example/spatiallm.git
cd spatiallm

# Install dependencies using Poetry
poetry install

# Create models directory
mkdir -p public/models/spatiallm

# Download model weights (replace URL with actual model URL)
echo "Downloading model weights..."
curl -L -o public/models/spatiallm/model.pt https://example.com/spatiallm-model.pt

# Install Python dependencies
pip install -r requirements.txt

echo "SpatialLM setup completed successfully!"
echo "To activate the environment, run: conda activate spatiallm" 