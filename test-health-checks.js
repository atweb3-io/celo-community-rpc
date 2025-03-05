// Test script for the health check system
const axios = require('axios');

// RPC servers to test
const RPC_SERVERS = [
  // Mainnet
  'https://forno.celo.org',
  
  // Baklava
  'https://celo-baklava-dev.atweb3.dev',
  'https://baklava-forno.celo-testnet.org',
  
  // Alfajores
  'https://alfajores-forno.celo-testnet.org',
];

// Community RPC endpoints
const COMMUNITY_RPC_ENDPOINTS = [
  'https://rpc.celo-community.org',
  'https://baklava-rpc.celo-community.org',
  'https://alfajores-rpc.celo-community.org',
];

// Test parameters
const TIMEOUT_MS = 5000;
const NUM_REQUESTS = 10;

/**
 * Test the health check system by:
 * 1. Sending requests to all backends to verify they're working
 * 2. Sending requests to the community RPC endpoints to verify they're using healthy backends
 * 3. Simulating a failure by sending invalid requests to a backend
 * 4. Verifying that the backend is marked as unhealthy
 */
async function testHealthChecks() {
  console.log('=== Testing Health Check System ===\n');
  
  // Step 1: Test all backends directly
  console.log('Step 1: Testing all backends directly...\n');
  await testAllBackends();
  
  // Step 2: Test community RPC endpoints
  console.log('\nStep 2: Testing community RPC endpoints...\n');
  await testCommunityRpcEndpoints();
  
  // Step 3: Simulate a failure
  console.log('\nStep 3: Simulating a backend failure...\n');
  await simulateBackendFailure();
  
  console.log('\n=== Health Check System Test Complete ===');
}

/**
 * Test all backends directly
 */
async function testAllBackends() {
  for (const server of RPC_SERVERS) {
    try {
      const blockNumber = await getBlockNumber(server);
      console.log(`✅ ${server} is healthy (block: ${blockNumber})`);
    } catch (error) {
      console.error(`❌ ${server} is unhealthy: ${error.message}`);
    }
  }
}

/**
 * Test community RPC endpoints
 */
async function testCommunityRpcEndpoints() {
  for (const endpoint of COMMUNITY_RPC_ENDPOINTS) {
    try {
      // Send multiple requests to verify load balancing
      const backendServers = new Set();
      
      for (let i = 0; i < NUM_REQUESTS; i++) {
        const { blockNumber, backendServer } = await getBlockNumberWithBackend(endpoint);
        backendServers.add(backendServer);
        
        if (i === 0) {
          console.log(`✅ ${endpoint} is healthy (block: ${blockNumber})`);
        }
      }
      
      console.log(`   Used ${backendServers.size} backend(s): ${Array.from(backendServers).join(', ')}`);
    } catch (error) {
      console.error(`❌ ${endpoint} is unhealthy: ${error.message}`);
    }
  }
}

/**
 * Simulate a backend failure
 */
async function simulateBackendFailure() {
  // Use the first community RPC endpoint for testing
  const endpoint = COMMUNITY_RPC_ENDPOINTS[0];
  
  try {
    // Get the backend server used for a request
    const { backendServer } = await getBlockNumberWithBackend(endpoint);
    console.log(`Using backend server: ${backendServer}`);
    
    // Send an invalid request to the community RPC endpoint
    console.log('Sending invalid request to simulate failure...');
    await sendInvalidRequest(endpoint);
    
    // Wait for the health check to take effect
    console.log('Waiting for health check to take effect (3 seconds)...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Send multiple requests to verify the backend is excluded
    const backendServers = new Set();
    
    for (let i = 0; i < NUM_REQUESTS; i++) {
      const { backendServer: newBackendServer } = await getBlockNumberWithBackend(endpoint);
      backendServers.add(newBackendServer);
    }
    
    if (!backendServers.has(backendServer)) {
      console.log(`✅ Backend ${backendServer} was excluded from rotation`);
    } else {
      console.log(`❌ Backend ${backendServer} was not excluded from rotation`);
    }
    
    console.log(`   Used ${backendServers.size} backend(s): ${Array.from(backendServers).join(', ')}`);
  } catch (error) {
    console.error(`❌ Error simulating backend failure: ${error.message}`);
  }
}

/**
 * Get the current block number from an RPC endpoint
 */
async function getBlockNumber(endpoint) {
  const response = await axios.post(
    endpoint,
    {
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: Date.now()
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: TIMEOUT_MS
    }
  );
  
  if (response.data.error) {
    throw new Error(`RPC error: ${response.data.error.message}`);
  }
  
  return parseInt(response.data.result, 16);
}

/**
 * Get the current block number and backend server from a community RPC endpoint
 */
async function getBlockNumberWithBackend(endpoint) {
  const response = await axios.post(
    endpoint,
    {
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: Date.now()
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: TIMEOUT_MS
    }
  );
  
  if (response.data.error) {
    throw new Error(`RPC error: ${response.data.error.message}`);
  }
  
  const backendServer = response.headers['x-backend-server'];
  return {
    blockNumber: parseInt(response.data.result, 16),
    backendServer
  };
}

/**
 * Send an invalid request to an RPC endpoint
 */
async function sendInvalidRequest(endpoint) {
  try {
    // Simulate a network error by using a timeout of 1ms
    // This will cause the request to timeout, which will trigger the HTTP error path
    await axios.post(
      endpoint,
      {
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: Date.now()
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 1 // 1ms timeout will almost certainly cause a timeout error
      }
    );
  } catch (error) {
    // Expected to fail with a timeout error
    console.log(`Successfully simulated a failure: ${error.message}`);
    return;
  }
}

// Run the tests
testHealthChecks().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});