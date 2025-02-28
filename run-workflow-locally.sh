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

# Check if .secrets file exists
if [ -f ".secrets" ]; then
    echo "Found .secrets file. Will use secrets for the workflow."
    SECRETS_ARG="--secret-file .secrets"
else
    echo "No .secrets file found. Running without secrets."
    echo "Note: For pull request creation to work properly, you need a GH_PAT secret."
    echo "To add it, create a .secrets file with: echo \"GH_PAT=your_token\" > .secrets"
    echo ""
    SECRETS_ARG=""
fi

# Run the workflow
act -j update-rpc-servers $SECRETS_ARG

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
    
    # Check if the error might be related to missing GH_PAT
    if [ -z "$SECRETS_ARG" ]; then
        echo ""
        echo "If the error is related to creating a pull request, you may need to provide a GH_PAT."
        echo "Create a .secrets file with: echo \"GH_PAT=your_token\" > .secrets"
    fi
fi