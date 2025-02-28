const axios = require('axios');

// List of RPC servers to test
const RPC_SERVERS = [
  // Mainnet
  'https://forno.celo.org',
  
  // Baklava
  'https://celo-baklava-dev.atweb3.dev',
  
  // Alfajores
  'https://alfajores-forno.celo-testnet.org',
  
  // Add any other RPC servers you want to test
];

// Maximum timeout for RPC health checks (ms)
const HEALTH_CHECK_TIMEOUT = 5000;

/**
 * Check if an RPC server is healthy
 * @param {string} url - The RPC server URL to check
 * @returns {Promise<boolean>} - Whether the server is healthy
 */
async function checkRpcServerHealth(url) {
  console.log(`Testing ${url}...`);
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
    
    if (isHealthy) {
      console.log(`✅ ${url} is HEALTHY`);
      console.log(`   Block number: ${parseInt(response.data.result, 16)}`);
    } else {
      console.log(`❌ ${url} is UNHEALTHY`);
      console.log(`   Response: ${JSON.stringify(response.data)}`);
    }
    
    return isHealthy;
  } catch (error) {
    console.error(`❌ Health check failed for ${url}:`);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Data: ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      console.error(`   No response received. Timeout or network error.`);
    } else {
      console.error(`   Error: ${error.message}`);
    }
    return false;
  }
}

/**
 * Test all RPC servers
 */
async function testAllRpcServers() {
  console.log('Starting RPC server health checks...\n');
  
  const results = [];
  
  for (const server of RPC_SERVERS) {
    const isHealthy = await checkRpcServerHealth(server);
    results.push({ server, isHealthy });
    console.log(''); // Add empty line for readability
  }
  
  // Summary
  console.log('\n=== SUMMARY ===');
  const healthy = results.filter(r => r.isHealthy).length;
  console.log(`✅ Healthy: ${healthy}/${results.length}`);
  console.log(`❌ Unhealthy: ${results.length - healthy}/${results.length}`);
  
  if (healthy < results.length) {
    console.log('\nUnhealthy servers:');
    results.filter(r => !r.isHealthy).forEach(r => {
      console.log(`- ${r.server}`);
    });
  }
}

// Run the tests
testAllRpcServers().catch(error => {
  console.error('Error testing RPC servers:', error);
  process.exit(1);
});