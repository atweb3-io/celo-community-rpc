const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Check if running in test/dry-run mode
const isDryRun = process.env.NODE_ENV === 'test';
if (isDryRun) {
  console.log('Running in DRY RUN mode - no files will be modified');
}

// Networks to update
const NETWORKS = ['mainnet', 'baklava', 'alfajores'];

// Default RPC endpoints that should always be included
const DEFAULT_ENDPOINTS = {
  'mainnet': ['https://forno.celo.org'],
  'baklava': ['https://celo-baklava-dev.atweb3.dev', 'https://baklava-forno.celo-testnet.org'],
  'alfajores': ['https://alfajores-forno.celo-testnet.org']
};

// Maximum timeout for RPC health checks (ms)
const HEALTH_CHECK_TIMEOUT = 5000;

// Number of consecutive failures before removing an RPC server
const MAX_FAILURES = 3;

// Store health check history for each network
const healthHistory = {};

// Load health history for each network
for (const network of NETWORKS) {
  const historyPath = path.join(__dirname, network, 'health-history.json');
  try {
    healthHistory[network] = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    console.log(`Loaded health history for ${network}`);
  } catch (error) {
    console.log(`No health history found for ${network}, creating new history`);
    healthHistory[network] = {};
  }
}

/**
 * Query RPC servers from the blockchain using celocli
 * @param {string} network - The network to query (mainnet, baklava, alfajores)
 * @returns {string[]} - Array of RPC server URLs
 */
async function queryRpcServersFromBlockchain(network) {
  try {
    console.log(`Executing celocli command for ${network}...`);
    // Execute celocli command to get RPC URLs with a timeout
    const command = `celocli network:rpc-urls --node ${network}`;
    const output = execSync(command, { timeout: 60000 }).toString(); // 60 second timeout
    console.log(`celocli command for ${network} completed successfully`);
    
    // Parse the output to extract RPC URLs
    // The celocli output format includes validator addresses after the URLs
    const urls = output.split('\n')
      .filter(line => line.trim().includes('http'))
      .map(line => {
        // Split the line by spaces and find the URL part
        const parts = line.trim().split(/\s+/);
        // Find the part that starts with http
        const url = parts.find(part => part.startsWith('http'));
        return url;
      })
      .filter(Boolean); // Remove any undefined values
    
    console.log(`Found ${urls.length} RPC servers for ${network} from blockchain`);
    return urls;
  } catch (error) {
    console.error(`Error querying RPC servers for ${network}:`, error.message);
    return [];
  }
}

/**
 * Check if an RPC server is healthy
 * @param {string} url - The RPC server URL to check
 * @returns {boolean} - Whether the server is healthy
 */
async function checkRpcServerHealth(url) {
  console.log(`Starting health check for ${url}...`);
  
  // Validate URL format first
  try {
    new URL(url); // This will throw if the URL is invalid
  } catch (error) {
    console.error(`Health check failed for ${url}: Invalid URL`);
    return false;
  }

  try {
    // Simple JSON-RPC request to check if the server is responsive
    console.log(`Sending request to ${url}...`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);
    
    const response = await axios.post(url,
      {
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: HEALTH_CHECK_TIMEOUT,
        signal: controller.signal
      }
    );
    
    clearTimeout(timeoutId);
    
    // Check if the response is valid
    const isHealthy = response.status === 200 &&
                     response.data &&
                     response.data.result &&
                     !response.data.error;
    
    console.log(`Health check for ${url}: ${isHealthy ? 'HEALTHY' : 'UNHEALTHY'}`);
    return isHealthy;
  } catch (error) {
    if (error.code === 'ECONNABORTED' || error.name === 'AbortError') {
      console.error(`Health check timed out for ${url} after ${HEALTH_CHECK_TIMEOUT}ms`);
    } else {
      console.error(`Health check failed for ${url}:`, error.message);
    }
    return false;
  }
}

/**
 * Update the health history for an RPC server
 * @param {string} network - The network (mainnet, baklava, alfajores)
 * @param {string} url - The RPC server URL
 * @param {boolean} isHealthy - Whether the server is healthy
 * @returns {boolean} - Whether the server should be included
 */
function updateHealthHistory(network, url, isHealthy) {
  if (!healthHistory[network][url]) {
    healthHistory[network][url] = {
      consecutiveFailures: 0,
      lastChecked: new Date().toISOString(),
      history: []
    };
  }
  
  const entry = healthHistory[network][url];
  
  // Update consecutive failures
  if (isHealthy) {
    entry.consecutiveFailures = 0;
  } else {
    entry.consecutiveFailures += 1;
  }
  
  // Update history
  entry.history.push({
    timestamp: new Date().toISOString(),
    healthy: isHealthy
  });
  
  // Keep only the last 10 history entries
  if (entry.history.length > 10) {
    entry.history = entry.history.slice(-10);
  }
  
  entry.lastChecked = new Date().toISOString();
  
  // Server should be included if it's healthy or hasn't failed too many times
  return isHealthy || entry.consecutiveFailures < MAX_FAILURES;
}

/**
 * Update the RPC servers file for a network
 * @param {string} network - The network to update
 * @param {string[]} servers - The list of healthy RPC servers
 * @returns {string[]} - The list of all servers (including default endpoints)
 */
function updateRpcServersFile(network, servers) {
  const filePath = path.join(__dirname, network, 'rpc-servers.js');
  
  // Ensure default endpoints are included
  const defaultEndpoints = DEFAULT_ENDPOINTS[network] || [];
  const allServers = [...new Set([...defaultEndpoints, ...servers])];
  
  // Create the file content
  const fileContent = `// ${network.charAt(0).toUpperCase() + network.slice(1)} ${network === 'mainnet' ? '' : 'testnet '}RPC server list
// This file can be updated by "celocli network:rpc-urls" to fetch registered RPC servers and check their health

export const backendList = [
  ${allServers.map(server => `'${server}'`).join(',\n  ')}
];`;
  
  if (isDryRun) {
    console.log(`\n[DRY RUN] Would update ${filePath} with ${allServers.length} RPC servers:`);
    console.log(fileContent);
  } else {
    // Write the file
    fs.writeFileSync(filePath, fileContent);
    console.log(`Updated ${filePath} with ${allServers.length} RPC servers`);
  }
  
  return allServers;
}

/**
 * Save the health history to network-specific files
 */
function saveHealthHistory() {
  for (const network of NETWORKS) {
    const historyPath = path.join(__dirname, network, 'health-history.json');
    
    if (isDryRun) {
      console.log(`\n[DRY RUN] Would save health history for ${network} to ${historyPath}:`);
      console.log(JSON.stringify(healthHistory[network], null, 2));
    } else {
      fs.writeFileSync(historyPath, JSON.stringify(healthHistory[network], null, 2));
      console.log(`Saved health history for ${network} to ${historyPath}`);
    }
  }
}

/**
 * Update the website's script.js file with the latest RPC servers
 * @param {Object} networkServers - Object containing server lists for each network
 */
function updateWebsiteScript(networkServers) {
  const scriptPath = path.join(__dirname, 'public', 'script.js');
  
  try {
    // Read the current script.js file
    let scriptContent = fs.readFileSync(scriptPath, 'utf8');
    
    // Find the networks object in the script
    const networksRegex = /(const\s+networks\s*=\s*\{[\s\S]*?\};)/;
    const match = scriptContent.match(networksRegex);
    
    if (match) {
      // Create the new networks object
      const newNetworksObject = `const networks = {
        mainnet: {
            name: 'Mainnet',
            servers: [
                ${networkServers.mainnet.map(server => `'${server}'`).join(',\n                ')}
            ]
        },
        alfajores: {
            name: 'Alfajores',
            servers: [
                ${networkServers.alfajores.map(server => `'${server}'`).join(',\n                ')}
            ]
        },
        baklava: {
            name: 'Baklava',
            servers: [
                ${networkServers.baklava.map(server => `'${server}'`).join(',\n                ')}
            ]
        }
    };`;
      
      // Replace the old networks object with the new one
      const updatedContent = scriptContent.replace(networksRegex, newNetworksObject);
      
      if (isDryRun) {
        console.log(`\n[DRY RUN] Would update ${scriptPath} with latest RPC servers`);
      } else {
        // Write the updated script.js file
        fs.writeFileSync(scriptPath, updatedContent);
        console.log(`Updated ${scriptPath} with latest RPC servers`);
      }
    } else {
      console.error('Could not find networks object in script.js');
    }
  } catch (error) {
    console.error('Error updating website script:', error.message);
  }
}

/**
 * Main function to update RPC servers for all networks
 */
async function updateAllRpcServers() {
  // Object to store all network servers
  const networkServers = {};
  
  for (const network of NETWORKS) {
    console.log(`\nProcessing ${network}...`);
    
    // Get current RPC servers from file
    const currentServersFile = path.join(__dirname, network, 'rpc-servers.js');
    let currentServers = [];
    try {
      const fileContent = fs.readFileSync(currentServersFile, 'utf8');
      const match = fileContent.match(/backendList\s*=\s*\[([\s\S]*?)\]/);
      if (match && match[1]) {
        currentServers = match[1]
          .split(',')
          .map(line => line.trim())
          .filter(line => line.startsWith("'") || line.startsWith('"'))
          .map(line => line.replace(/['"]/g, ''));
      }
    } catch (error) {
      console.error(`Error reading current servers for ${network}:`, error.message);
    }
    
    // Query new RPC servers from blockchain
    const blockchainServers = await queryRpcServersFromBlockchain(network);
    
    // Get default endpoints for this network
    const defaultEndpoints = DEFAULT_ENDPOINTS[network] || [];
    
    // Filter current servers to only keep those that are:
    // 1. In the blockchain servers list, or
    // 2. Are default endpoints
    const filteredServers = currentServers.filter(server =>
      blockchainServers.includes(server) || defaultEndpoints.includes(server)
    );
    
    // Add any new servers from blockchain that aren't in the filtered list
    const allServers = [...new Set([...filteredServers, ...blockchainServers])];
    
    // Check health of all servers in parallel with a maximum concurrency
    console.log(`Checking health of ${allServers.length} servers for ${network}...`);
    const healthyServers = [];
    const MAX_CONCURRENT_CHECKS = 5; // Check 5 servers at a time
    
    // Process servers in batches to avoid too many concurrent connections
    for (let i = 0; i < allServers.length; i += MAX_CONCURRENT_CHECKS) {
      const batch = allServers.slice(i, i + MAX_CONCURRENT_CHECKS);
      console.log(`Processing batch ${i/MAX_CONCURRENT_CHECKS + 1} of ${Math.ceil(allServers.length/MAX_CONCURRENT_CHECKS)} for ${network}`);
      
      // Run health checks in parallel for this batch
      const results = await Promise.all(
        batch.map(async (server) => {
          const isHealthy = await checkRpcServerHealth(server);
          return { server, isHealthy };
        })
      );
      
      // Process results
      for (const { server, isHealthy } of results) {
        // Only include servers that are actually healthy
        if (isHealthy) {
          // Update health history
          updateHealthHistory(network, server, isHealthy);
          healthyServers.push(server);
        } else {
          // Still update health history for tracking purposes
          updateHealthHistory(network, server, isHealthy);
          console.log(`Skipping unhealthy server: ${server}`);
        }
      }
    }
    
    console.log(`Health check completed for ${network}: ${healthyServers.length} healthy servers found`);
    
    // Update the RPC servers file and store the servers for website update
    networkServers[network] = updateRpcServersFile(network, healthyServers);
  }
  
  // Save health history
  saveHealthHistory();
  
  // Check if public folder and script.js exist
  const scriptPath = path.join(__dirname, 'public', 'script.js');
  if (fs.existsSync(scriptPath)) {
    // Update the website script with the latest RPC servers
    updateWebsiteScript(networkServers);
  } else {
    console.log(`Website script not found at ${scriptPath}, skipping website update`);
  }
}

// Run the update
updateAllRpcServers().catch(error => {
  console.error('Error updating RPC servers:', error);
  process.exit(1);
});