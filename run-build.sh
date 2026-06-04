#!/bin/bash
# A wrapper script to build the site safely.
# Since this project is on an external drive mounted with 'noexec', 
# Node native addons (like nodejieba) cannot be executed directly.
# This script copies the project to /tmp, builds it there, and copies the results back.

echo "Running build process in /tmp to bypass 'noexec' mount restrictions..."
BUILD_DIR="/tmp/Novel-Web-Build"

# Copy files, excluding node_modules to avoid corrupt states
mkdir -p "$BUILD_DIR"
for file in *; do
    if [ "$file" != "node_modules" ]; then
        cp -r "$file" "$BUILD_DIR/" || true
    fi
done

cd "$BUILD_DIR"

echo "Ensuring dependencies are installed..."
if [ ! -d "node_modules" ]; then
    npm install
fi

# Run the dictionary parser if dictionary doesn't exist
if [ ! -f "dictionary.json" ]; then
    echo "Dictionary not found. Initializing dictionary (this may take a minute)..."
    node init-dict.js
fi

echo "Running build..."
node build.js

echo "Copying generated public folder back to project..."
cp -r public "$OLDPWD/"

echo "Syncing translated content back to the Novel directory..."
cp -r Novel/* "$OLDPWD/Novel/" || true

echo "Done! You can now deploy the public/ folder to GitHub Pages."
