#!/bin/bash
# Render build script — installs Python deps, builds React, done.
set -e

echo "=== Installing Python dependencies ==="
pip install -r requirements.txt

echo "=== Installing Node dependencies ==="
cd frontend
npm install

echo "=== Building React frontend ==="
npm run build
# Output goes to ../static/ (served by FastAPI)

cd ..
echo "=== Build complete ==="
ls -la static/
