#!/bin/bash
# Nuke Box Setup Script
# Sets up local environment for image scanning and classification

set -e

echo "==================================="
echo "Nuke Box Setup"
echo "==================================="

# Check Python version
PYTHON_VERSION=$(python3 --version 2>&1 | cut -d' ' -f2 | cut -d'.' -f1,2)
echo "Python version: $PYTHON_VERSION"

if [[ $(echo "$PYTHON_VERSION < 3.9" | bc -l) -eq 1 ]]; then
    echo "Error: Python 3.9+ required"
    exit 1
fi

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install dependencies
echo "Installing Python dependencies..."
pip install --upgrade pip
pip install pillow requests rich

# Check for Ollama
echo ""
echo "Checking for Ollama..."
if command -v ollama &> /dev/null; then
    echo "Ollama found!"

    # Check if llava model is available
    if ollama list 2>/dev/null | grep -q "llava"; then
        echo "LLaVA model already installed"
    else
        echo "Pulling LLaVA model (this may take a while)..."
        ollama pull llava
    fi
else
    echo "WARNING: Ollama not found."
    echo "Install from: https://ollama.ai"
    echo "Then run: ollama pull llava"
    echo ""
    echo "Scanner will work without Ollama but won't classify images."
fi

echo ""
echo "==================================="
echo "Setup Complete!"
echo "==================================="
echo ""
echo "STEP 1: Activate environment"
echo "  source venv/bin/activate"
echo ""
echo "STEP 2: Scan your photos"
echo "  python scanner.py ~/Pictures --output ./scan_results"
echo ""
echo "STEP 3: Login to Nuke (one time)"
echo "  python sync.py --login"
echo ""
echo "STEP 4: Upload to Nuke"
echo "  python sync.py ./scan_results/manifest.json"
echo ""
echo "Optional - dry run (no actual uploads):"
echo "  python sync.py ./scan_results/manifest.json --dry-run"
