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
  'baklava': ['https://celo-baklava-dev.atweb3.dev'],
  'alfajores': ['https://alfajores-forno.celo-testnet.org']
};

// Maximum timeout for RPC health checks (ms)
const HEALTH_CHECK_TIMEOUT = 5000;

// Number of consecutive failures before removing an RPC server
const MAX_FAILURES = 3;

// Store health check history
let healthHistory = {};
try {
  healthHistory = JSON.parse(fs.readFileSync('health-history.json', 'utf8'));
} catch (error) {
  console.log('No health history found, creating new history');
  healthHistory = {};
}

/**
 * Query RPC servers from the blockchain using celocli
 * @param {string} network - The network to query (mainnet, baklava, alfajores)
 * @returns {string[]} - Array of RPC server URLs
 */
async function queryRpcServersFromBlockchain(network) {
  try {
    // Execute celocli command to get RPC URLs
    const command = `celocli network:rpc-urls --node ${network}`;
    const output = execSync(command).toString();
    
    // Parse the output to extract RPC URLs
    // This will depend on the exact format of the celocli output
    const urls = output.split('\n')
      .filter(line => line.trim().startsWith('http'))
      .map(line => line.trim());
    
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
  try {
    // Simple JSON-RPC request to check if the server is responsive
    const response = await axios.post(url, 
      {
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: HEALTH_CHECK_TIMEOUT
      }
    );
    
    // Check if the response is valid
    const isHealthy = response.status === 200 && 
                     response.data && 
                     response.data.result && 
                     !response.data.error;
    
    console.log(`Health check for ${url}: ${isHealthy ? 'HEALTHY' : 'UNHEALTHY'}`);
    return isHealthy;
  } catch (error) {
    console.error(`Health check failed for ${url}:`, error.message);
    return false;
  }
}

/**
 * Update the health history for an RPC server
 * @param {string} url - The RPC server URL
 * @param {boolean} isHealthy - Whether the server is healthy
 * @returns {boolean} - Whether the server should be included
 */
function updateHealthHistory(url, isHealthy) {
  if (!healthHistory[url]) {
    healthHistory[url] = {
      consecutiveFailures: 0,
      lastChecked: new Date().toISOString(),
      history: []
    };
  }
  
  const entry = healthHistory[url];
  
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
 */
function updateRpcServersFile(network, servers) {
  const filePath = path.join(__dirname, network, 'rpc-servers.js');
  
  // Ensure default endpoints are included
  const defaultEndpoints = DEFAULT_ENDPOINTS[network] || [];
  const allServers = [...new Set([...defaultEndpoints, ...servers])];
  
  // Create the file content
  const fileContent = `// ${network.charAt(0).toUpperCase() + network.slice(1)} ${network === 'mainnet' ? '' : 'testnet '}RPC server list
// This file can be updated by "celocli network:rpc-urls" to fetch registered RPC servers and check their health
// Last updated: ${new Date().toISOString()}

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
}

/**
 * Save the health history to a file
 */
function saveHealthHistory() {
  if (isDryRun) {
    console.log(`\n[DRY RUN] Would save health history to health-history.json:`);
    console.log(JSON.stringify(healthHistory, null, 2));
  } else {
    fs.writeFileSync('health-history.json', JSON.stringify(healthHistory, null, 2));
    console.log('Saved health history to health-history.json');
  }
}

/**
 * Main function to update RPC servers for all networks
 */
async function updateAllRpcServers() {
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
    
    // Check health of all servers
    const healthyServers = [];
    for (const server of allServers) {
      const isHealthy = await checkRpcServerHealth(server);
      const shouldInclude = updateHealthHistory(server, isHealthy);
      
      if (shouldInclude) {
        healthyServers.push(server);
      }
    }
    
    // Update the RPC servers file
    updateRpcServersFile(network, healthyServers);
  }
  
  // Save health history
  saveHealthHistory();
}

// Run the update
updateAllRpcServers().catch(error => {
  console.error('Error updating RPC servers:', error);
  process.exit(1);
});