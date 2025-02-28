#!/bin/bash

# This script runs the GitHub Actions workflow locally using the act tool
# https://github.com/nektos/act

# Check if act is installed
if ! command -v act &> /dev/null; then
    echo "Error: 'act' is not installed."
    echo "Please install it first:"
    echo "  macOS: brew install act"
    echo "  Other: https://github.com/nektos/act#installation"
    exit 1
fi

# Check if Docker is running
if ! docker info &> /dev/null; then
    echo "Error: Docker is not running."
    echo "Please start Docker and try again."
    exit 1
fi

echo "Running update-rpc-servers workflow locally..."
echo "This will simulate the GitHub Actions environment using Docker."
echo "Note: The pull request creation step will be simulated but not actually create a PR."
echo ""

# Run the workflow
act -j update-rpc-servers

# Check if the workflow ran successfully
if [ $? -eq 0 ]; then
    echo ""
    echo "Workflow completed successfully!"
    echo ""
    echo "To see the changes that would be made:"
    echo "  git status"
    echo "  git diff"
    echo ""
    echo "To reset any changes made during testing:"
    echo "  git checkout -- ."
else
    echo ""
    echo "Workflow failed. See above for errors."
fi