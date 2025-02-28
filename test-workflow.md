# Testing the RPC Server Update Workflow Locally

## Option 1: Using the `act` tool

The `act` tool allows you to run GitHub Actions workflows locally using Docker.

### Installation

1. Install `act`:

   **macOS (using Homebrew):**
   ```bash
   brew install act
   ```

   **Other platforms:**
   See [act installation instructions](https://github.com/nektos/act#installation)

2. Make sure Docker is installed and running on your system.

### Running the workflow

1. If you want to test the pull request creation step, you'll need to provide a GitHub Personal Access Token:
   ```bash
   # Create a .secrets file (git-ignored)
   echo "GH_PAT=your_personal_access_token" > .secrets
   ```

2. From the root of the repository, run:
   ```bash
   # Without secrets
   act -j update-rpc-servers
   
   # Or with secrets
   act -j update-rpc-servers --secret-file .secrets
   ```

3. This will execute the entire workflow locally, including:
   - Setting up Node.js
   - Installing dependencies
   - Running the update-rpc-servers.js script
   - Creating a simulated pull request

### Notes about `act`

- `act` uses Docker to simulate the GitHub Actions environment
- Some actions might not work exactly the same as on GitHub
- The pull request creation step will be simulated but not actually create a PR
- For full functionality with the peter-evans/create-pull-request action, you need to provide a GH_PAT

## Option 2: Manual Testing

If you prefer not to use `act`, you can manually run the commands from the workflow:

1. Install dependencies:
   ```bash
   npm install axios
   npm install -g @celo/celocli
   ```

2. Run the update script:
   ```bash
   node update-rpc-servers.js
   ```

3. Check the changes:
   ```bash
   git diff
   ```

## Option 3: Testing Just the Script

If you just want to test the script functionality:

1. Install dependencies:
   ```bash
   npm install
   npm install -g @celo/celocli
   ```

2. Run the script with debugging output:
   ```bash
   NODE_DEBUG=axios node update-rpc-servers.js
   ```

3. To test without actually writing changes (dry run), you can temporarily modify the script:
   - Open `update-rpc-servers.js`
   - Find the `updateRpcServersFile` function
   - Add `console.log(fileContent); return;` before the `fs.writeFileSync` line
   - Run the script again

## Troubleshooting

### celocli Issues

If you encounter issues with celocli:

1. Make sure you have the latest version:
   ```bash
   npm install -g @celo/celocli@latest
   ```

2. Test celocli directly:
   ```bash
   celocli network:rpc-urls --node baklava
   ```

### Network Issues

If health checks are failing:

1. Check your internet connection
2. Try with a longer timeout by modifying `HEALTH_CHECK_TIMEOUT` in the script

### Permission Issues

If you encounter permission issues:

1. Make sure you have write access to the directories
2. Run with sudo if necessary (not recommended for npm installs)