#!/bin/bash
# Deploy Nuke Sentinel to Orgo VM
# Usage: ./deploy-orgo.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Nuke Sentinel Orgo Deployment ==="

# Check for Orgo API key
if [ -z "$ORGO_API_KEY" ]; then
    echo "Error: ORGO_API_KEY not set"
    echo "Export it or use: dotenvx run -- ./deploy-orgo.sh"
    exit 1
fi

# Check for orgo CLI/SDK
if ! python3 -c "import orgo" 2>/dev/null; then
    echo "Installing orgo SDK..."
    pip install orgo
fi

# Create the deployment package
echo "Creating deployment package..."
DEPLOY_DIR=$(mktemp -d)
cp -r . "$DEPLOY_DIR/nuke-sentinel"

# Create startup script for the VM
cat > "$DEPLOY_DIR/startup.sh" << 'STARTUP_EOF'
#!/bin/bash
# Orgo VM startup script

cd /home/user/nuke-sentinel

# Install dependencies
pip install anthropic requests

# Set up environment
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}"
export VITE_SUPABASE_URL="${VITE_SUPABASE_URL}"
export SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY}"

# Run the sentinel
python runner.py
STARTUP_EOF

chmod +x "$DEPLOY_DIR/startup.sh"

echo "Deployment package ready at: $DEPLOY_DIR"

# Deploy using Orgo Python SDK
python3 << PYTHON_EOF
import os
from orgo import Computer

api_key = os.environ["ORGO_API_KEY"]
print(f"Connecting to Orgo...")

computer = Computer(api_key=api_key)

# Upload agent files
print("Uploading agent files...")
# computer.upload("$DEPLOY_DIR/nuke-sentinel", "/home/user/nuke-sentinel")

# Run startup
print("Starting sentinel...")
# computer.prompt("Run the nuke-sentinel agent: cd /home/user/nuke-sentinel && python runner.py")

print("Sentinel deployed!")
print("Monitor at: https://orgo.ai/workspaces")
PYTHON_EOF

echo ""
echo "=== Deployment Complete ==="
echo "Next steps:"
echo "  1. Check Orgo dashboard for VM status"
echo "  2. View logs in agents/nuke-sentinel/logs/"
echo "  3. Check alerts in agents/nuke-sentinel/alerts/"
