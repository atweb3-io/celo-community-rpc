// Health Check Worker for Celo Community RPC
// This worker runs on a schedule and performs health checks on all backends

// Import backend lists from all networks
import { backendList as mainnetBackends } from './mainnet/rpc-servers.js';
import { backendList as baklavaBackends } from './baklava/rpc-servers.js';
import { backendList as alfajoresBackends } from './alfajores/rpc-servers.js';

// Constants
const HEALTH_CHECK_TIMEOUT_MS = 5000; // 5 seconds
const HEALTH_CHECK_COOLDOWN_MS = 300000; // 5 minutes (300 seconds)

// Network configurations
const NETWORKS = [
  { name: 'mainnet', backends: mainnetBackends },
  { name: 'baklava', backends: baklavaBackends },
  { name: 'alfajores', backends: alfajoresBackends }
];

/**
 * Main worker entry point - runs on a schedule and handles HTTP requests
 */
export default {
  // Handle scheduled events (cron triggers)
  async scheduled(event, env, ctx) {
    console.log('Running scheduled health check');
    await checkAllBackends(env);
  },
  
  // Handle HTTP requests
  async fetch(request, env, ctx) {
    // Get the current health status
    const results = await getHealthStatus(env);
    
    // Return the health status as JSON
    return new Response(JSON.stringify(results, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
};

/**
 * Get the current health status of all backends
 * @param {Object} env - Environment variables and bindings
 * @returns {Promise<Object>} - Health status for all networks
 */
async function getHealthStatus(env) {
  const results = {
    timestamp: new Date().toISOString(),
    networks: {}
  };
  
  for (const network of NETWORKS) {
    results.networks[network.name] = {
      healthy: [],
      unhealthy: []
    };
    
    for (const backend of network.backends) {
      // Check if the backend is marked as down
      const isDown = await env.HEALTH_KV.get(`down:${backend}`);
      const reason = isDown || null;
      
      // Get additional information from KV store
      const blockHeight = await env.HEALTH_KV.get(`blockHeight:${backend}`);
      const lastChecked = await env.HEALTH_KV.get(`lastChecked:${backend}`);
      const validatorAddress = await env.HEALTH_KV.get(`validator:${backend}`);
      
      const backendInfo = {
        url: backend,
        blockHeight: blockHeight ? parseInt(blockHeight) : null,
        lastChecked: lastChecked || null,
        validatorAddress: validatorAddress || null
      };
      
      if (isDown) {
        results.networks[network.name].unhealthy.push({
          ...backendInfo,
          reason: reason
        });
      } else {
        results.networks[network.name].healthy.push(backendInfo);
      }
    }
  }
  
  return results;
}

/**
 * Check all backends for all networks
 * @param {Object} env - Environment variables and bindings
 */
async function checkAllBackends(env) {
  const results = [];
  
  // Try to get validator addresses from celocli
  await fetchValidatorAddresses(env);
  
  for (const network of NETWORKS) {
    console.log(`Checking backends for ${network.name}...`);
    
    for (const backend of network.backends) {
      try {
        // Check if the backend is already marked as down
        const isDown = await env.HEALTH_KV.get(`down:${backend}`);
        if (isDown) {
          console.log(`Backend ${backend} is currently marked as down, checking if it has recovered`);
          
          // Check if the backend has recovered
          const isHealthy = await checkBackendHealth(backend, env);
          if (isHealthy) {
            // If the backend has recovered, remove it from the down list
            await env.HEALTH_KV.delete(`down:${backend}`);
            console.log(`Backend ${backend} has recovered, removed from down list`);
          } else {
            console.log(`Backend ${backend} is still unhealthy`);
          }
          
          results.push({ network: network.name, backend, healthy: isHealthy, wasDown: true });
          continue;
        }
        
        // Perform health check
        const isHealthy = await checkBackendHealth(backend, env);
        results.push({ network: network.name, backend, healthy: isHealthy, wasDown: false });
        
        if (!isHealthy) {
          // Mark as unhealthy for 5 minutes
          await env.HEALTH_KV.put(`down:${backend}`, 'Failed active health check', { expirationTtl: HEALTH_CHECK_COOLDOWN_MS / 1000 });
          console.error(`Active check: Backend ${backend} marked as unhealthy`);
        }
      } catch (error) {
        console.error(`Error checking backend ${backend}: ${error.message}`);
        results.push({ network: network.name, backend, healthy: false, error: error.message });
        
        // Mark as unhealthy for 5 minutes
        await env.HEALTH_KV.put(`down:${backend}`, `Error: ${error.message}`, { expirationTtl: HEALTH_CHECK_COOLDOWN_MS / 1000 });
      }
    }
  }
  
  // Log summary
  const healthyCount = results.filter(r => r.healthy).length;
  const totalCount = results.length;
  console.log(`Health check summary: ${healthyCount}/${totalCount} backends are healthy`);
  
  // Log unhealthy backends
  const unhealthyBackends = results.filter(r => !r.healthy);
  if (unhealthyBackends.length > 0) {
    console.log('Unhealthy backends:');
    for (const result of unhealthyBackends) {
      console.log(`- ${result.network}: ${result.backend}`);
    }
  }
  
  return results;
}

/**
 * Fetch validator addresses from validator-addresses.json files and store them in KV
 * @param {Object} env - Environment variables and bindings
 */
async function fetchValidatorAddresses(env) {
  if (!env) return;
  
  for (const network of NETWORKS) {
    try {
      console.log(`Fetching validator addresses for ${network.name}...`);
      
      // Try to fetch the validator addresses from the KV store directly
      try {
        // Check if we have the validator addresses in the KV store
        const kvKey = `${network.name}/validator-addresses`;
        let validatorAddresses = null;
        
        // First try to get from the __STATIC_CONTENT KV namespace (if available)
        if (env.__STATIC_CONTENT) {
          // List keys to find the hashed filename
          const keys = await env.__STATIC_CONTENT.list({ prefix: `${network.name}/validator-addresses` });
          if (keys && keys.keys && keys.keys.length > 0) {
            // Get the first matching key (should be the hashed filename)
            const key = keys.keys[0].name;
            console.log(`Found validator addresses in __STATIC_CONTENT at key: ${key}`);
            const content = await env.__STATIC_CONTENT.get(key, { type: 'text' });
            if (content) {
              validatorAddresses = JSON.parse(content);
            }
          }
        }
        
        // If we couldn't get from __STATIC_CONTENT, try fetching from the same origin
        if (!validatorAddresses) {
          const validatorAddressesPath = `./${network.name}/validator-addresses.json`;
          // Use fetch to get the file from the same origin
          const response = await fetch(new URL(validatorAddressesPath, self.location.href));
          
          if (response.ok) {
            validatorAddresses = await response.json();
          } else {
            console.warn(`Could not load validator addresses for ${network.name}: ${response.status} ${response.statusText}`);
          }
        }
        
        if (validatorAddresses) {
          // Check if we need to update the KV store by comparing with existing values
          const updatedAddresses = [];
          
          for (const [url, address] of Object.entries(validatorAddresses)) {
            // Get the current value from KV
            const currentAddress = await env.HEALTH_KV.get(`validator:${url}`);
            
            // Only update if the address has changed
            if (currentAddress !== address) {
              await env.HEALTH_KV.put(`validator:${url}`, address);
              updatedAddresses.push(url);
              console.log(`Updated validator address for ${url}: ${address}`);
            }
          }
          
          if (updatedAddresses.length > 0) {
            console.log(`Updated ${updatedAddresses.length} validator addresses for ${network.name}`);
          } else {
            console.log(`No validator addresses needed updating for ${network.name}`);
          }
          
          console.log(`Successfully processed validator addresses for ${network.name}`);
        } else {
          console.warn(`Could not find validator addresses for ${network.name}`);
          // Fall back to using null addresses
          await setNullValidatorAddresses(network, env);
        }
      } catch (fetchError) {
        console.warn(`Error fetching validator addresses for ${network.name}:`, fetchError.message);
        // Fall back to using null addresses
        await setNullValidatorAddresses(network, env);
      }
    } catch (error) {
      console.error(`Error processing validator addresses for ${network.name}:`, error.message);
    }
  }
}

/**
 * Set validator addresses to null when real addresses aren't available
 * @param {Object} network - The network configuration
 * @param {Object} env - Environment variables and bindings
 */
async function setNullValidatorAddresses(network, env) {
  console.log(`Setting null validator addresses for ${network.name}...`);
  
  const updatedAddresses = [];
  
  for (const backend of network.backends) {
    try {
      // Get the current value from KV
      const currentAddress = await env.HEALTH_KV.get(`validator:${backend}`);
      
      // Only update if the address is not already null
      if (currentAddress !== null) {
        await env.HEALTH_KV.put(`validator:${backend}`, null);
        updatedAddresses.push(backend);
        console.log(`Set validator address for ${backend} to null`);
      }
    } catch (error) {
      console.error(`Error setting null validator address for ${backend}:`, error.message);
    }
  }
  
  if (updatedAddresses.length > 0) {
    console.log(`Updated ${updatedAddresses.length} validator addresses to null for ${network.name}`);
  } else {
    console.log(`No validator addresses needed updating for ${network.name}`);
  }
}

/**
 * Check if a backend is healthy
 * @param {string} backend - The backend URL to check
 * @param {Object} env - Environment variables and bindings
 * @returns {Promise<boolean>} - Whether the backend is healthy
 */
async function checkBackendHealth(backend, env) {
  console.log(`Checking health of ${backend}...`);
  const now = new Date().toISOString();
  
  try {
    // Create a JSON-RPC request to check node health
    const healthCheckRequest = {
      jsonrpc: '2.0',
      method: 'eth_syncing',
      params: [],
      id: Date.now()
    };
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
    
    const response = await fetch(backend, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(healthCheckRequest),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.error(`Health check failed for ${backend}: HTTP ${response.status}`);
      // Update last checked time even if unhealthy
      if (env) await env.HEALTH_KV.put(`lastChecked:${backend}`, now);
      return false;
    }
    
    const data = await response.json();
    
    // Check if the node is syncing
    // If result is false, the node is fully synced
    // If result is an object, the node is still syncing
    if (data.error) {
      console.error(`Health check failed for ${backend}: RPC error: ${data.error.message}`);
      // Update last checked time even if unhealthy
      if (env) await env.HEALTH_KV.put(`lastChecked:${backend}`, now);
      return false;
    }
    
    // If the node is syncing, mark it as unhealthy
    if (data.result && typeof data.result === 'object') {
      console.log(`Backend ${backend} is still syncing`);
      // Update last checked time even if unhealthy
      if (env) await env.HEALTH_KV.put(`lastChecked:${backend}`, now);
      return false;
    }
    
    // Also check block number to ensure the node is not stale
    const blockNumberRequest = {
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: Date.now() + 1
    };
    
    const blockNumberResponse = await fetch(backend, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(blockNumberRequest)
    });
    
    if (!blockNumberResponse.ok) {
      console.error(`Block number check failed for ${backend}: HTTP ${blockNumberResponse.status}`);
      // Update last checked time even if unhealthy
      if (env) await env.HEALTH_KV.put(`lastChecked:${backend}`, now);
      return false;
    }
    
    const blockData = await blockNumberResponse.json();
    
    if (blockData.error) {
      console.error(`Block number check failed for ${backend}: RPC error: ${blockData.error.message}`);
      // Update last checked time even if unhealthy
      if (env) await env.HEALTH_KV.put(`lastChecked:${backend}`, now);
      return false;
    }
    
    const blockNumber = parseInt(blockData.result, 16);
    console.log(`Backend ${backend} is at block ${blockNumber}`);
    
    // Store block height and last checked time in KV store
    if (env) {
      await env.HEALTH_KV.put(`blockHeight:${backend}`, blockNumber.toString());
      await env.HEALTH_KV.put(`lastChecked:${backend}`, now);
    }
    
    // Node is healthy
    console.log(`Backend ${backend} is healthy`);
    return true;
  } catch (error) {
    console.error(`Health check failed for ${backend}: ${error.message}`);
    // Update last checked time even if unhealthy
    if (env) await env.HEALTH_KV.put(`lastChecked:${backend}`, now);
    return false;
  }
}