// Health Check Worker for Celo Community RPC
// This worker runs on a schedule and performs health checks on all backends

// Import backend lists from all networks
import { backendList as mainnetBackends } from './mainnet/rpc-servers.js';
import { backendList as baklavaBackends } from './baklava/rpc-servers.js';
import { backendList as alfajoresBackends } from './alfajores/rpc-servers.js';

// Constants
const HEALTH_CHECK_TIMEOUT_MS = 10000; // 10 seconds
const HEALTH_CHECK_COOLDOWN_MS = 900000; // 15 minutes (900 seconds)
const KV_CACHE_TTL_SECONDS = 3600; // 1 hour cache TTL for KV values that don't change often

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
    
    // Clear the cached health status in KV to force regeneration
    await env.HEALTH_KV.delete('health_status_cache');
    console.log('Cleared KV cached health status');
    
    // Update the health status timestamp when running the scheduled check
    const newTimestamp = new Date().toISOString();
    await env.HEALTH_KV.put('health_status_timestamp', newTimestamp, { expirationTtl: 300 });
    console.log(`Updated health status timestamp to ${newTimestamp}`);
    
    // Run the health checks
    await checkAllBackends(env);
    
    // Generate and cache a new health status after checks are complete
    const results = await getHealthStatus(env);
    console.log('Generated new health status cache');
    
    // Purge the Cloudflare cache by tag
    try {
      // Get the API token from environment variables
      const apiToken = env.CF_API_TOKEN;
      const accountId = env.CF_ACCOUNT_ID;
      const zoneId = env.CF_ZONE_ID;
      
      if (apiToken && zoneId) {
        // Purge the cache by tag
        const purgeRequest = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            tags: ['health-status']
          })
        });
        
        const purgeResponse = await purgeRequest.json();
        if (purgeResponse.success) {
          console.log('Successfully purged Cloudflare cache by tag');
        } else {
          console.error('Failed to purge Cloudflare cache:', purgeResponse.errors);
        }
      } else {
        console.log('Skipping Cloudflare cache purge - API token or Zone ID not available');
      }
    } catch (error) {
      console.error('Error purging Cloudflare cache:', error);
    }
  },
  
  // Handle HTTP requests
  async fetch(request, env, ctx) {
    // Handle preflight OPTIONS request for CORS
    if (request.method === 'OPTIONS') {
      return handleCors();
    }
    
    // Check for cache control headers - only respect no-cache for manual refresh requests
    const cacheControl = request.headers.get('Cache-Control');
    const noCache = cacheControl &&
                   (cacheControl.includes('no-cache') ||
                    cacheControl.includes('max-age=0'));
    
    // Calculate cache TTL - shorter than the health check interval
    // Health check runs every 15 minutes, so cache for 5 minutes
    const CACHE_TTL_SECONDS = 300; // 5 minutes
    
    // Construct the cache key from the request URL
    const cacheUrl = new URL(request.url);
    const cacheKey = new Request(cacheUrl.toString(), request);
    
    // Get the Cloudflare cache
    const cache = caches.default;
    
    // If this is a force refresh request, skip the cache
    if (!noCache) {
      // Try to get the response from Cloudflare's cache
      let cachedResponse = await cache.match(cacheKey);
      
      if (cachedResponse) {
        console.log(`Cache hit for: ${request.url}`);
        return cachedResponse;
      }
      
      console.log(`Cache miss for: ${request.url}`);
    } else {
      console.log(`Bypassing cache for: ${request.url} due to no-cache header`);
    }
    
    // Get the current health status from our KV store
    const results = await getHealthStatus(env);
    
    // Create ETag from the timestamp
    const etag = `"${results.timestamp}"`;
    
    // Create a new response with appropriate headers
    const response = new Response(JSON.stringify(results, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        ...getCorsHeaders(),
        'Cache-Control': `public, s-maxage=${CACHE_TTL_SECONDS}`, // s-maxage for CDN caching
        'ETag': etag,
        'Last-Modified': new Date(results.timestamp).toUTCString(),
        'Vary': 'Accept-Encoding, Origin', // Vary header to ensure proper caching with different encodings
        'Cache-Tag': 'health-status', // For purging by tag if needed
      },
    });
    
    // Store the response in Cloudflare's cache
    if (!noCache) {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      console.log(`Cached response for: ${request.url}`);
    }
    
    return response;
  },
};

/**
 * Get the current health status of all backends
 * @param {Object} env - Environment variables and bindings
 * @returns {Promise<Object>} - Health status for all networks
 */
async function getHealthStatus(env) {
  // Try to get the cached health status from KV
  const CACHE_TTL_SECONDS = 300; // 5 minutes
  let cachedHealthStatus = await env.HEALTH_KV.get('health_status_cache', { type: 'json' });
  const now = new Date();
  
  // If we have a valid cached response, return it
  if (cachedHealthStatus) {
    // Only update the generated timestamp to show when this was served
    return {
      ...cachedHealthStatus,
      cached: true,
      served: now.toISOString()
    };
  }
  
  // If no cached response exists, generate a new one
  console.log('No cached health status found, generating new one');
  
  // Get the timestamp (or create a new one)
  let timestamp = await env.HEALTH_KV.get('health_status_timestamp');
  if (!timestamp) {
    timestamp = now.toISOString();
    await env.HEALTH_KV.put('health_status_timestamp', timestamp, { expirationTtl: CACHE_TTL_SECONDS });
  }
  
  const results = {
    timestamp: timestamp,
    generated: now.toISOString(),
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
      
      // Get additional information from KV store with caching for values that don't change often
      const blockHeight = await env.HEALTH_KV.get(`blockHeight:${backend}`);
      const lastChecked = await env.HEALTH_KV.get(`lastChecked:${backend}`);
      // Validator addresses don't change often, so we can use a longer cache TTL
      const validatorAddress = await env.HEALTH_KV.get(`validator:${backend}`, { cacheTtl: KV_CACHE_TTL_SECONDS });
      
      // Convert "null" string to actual null for the response
      const actualValidatorAddress = validatorAddress === "null" ? null : validatorAddress;
      
      const backendInfo = {
        url: backend,
        blockHeight: blockHeight ? parseInt(blockHeight) : null,
        lastChecked: lastChecked || null,
        validatorAddress: actualValidatorAddress
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
  
  // Cache the results for 5 minutes
  await env.HEALTH_KV.put('health_status_cache', JSON.stringify(results), { expirationTtl: CACHE_TTL_SECONDS });
  
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
        
        // Try to get from the STATIC_CONTENT_KV namespace (if available)
        if (env.STATIC_CONTENT_KV) {
          try {
            // Get the validator addresses directly from the KV store
            const key = `${network.name}/validator-addresses.json`;
            console.log(`Trying to get validator addresses from STATIC_CONTENT_KV with key: ${key}`);
            
            const content = await env.STATIC_CONTENT_KV.get(key, { type: 'text' });
            if (content) {
              console.log(`Found validator addresses in STATIC_CONTENT_KV for ${network.name}`);
              validatorAddresses = JSON.parse(content);
            } else {
              console.warn(`No content found in STATIC_CONTENT_KV for key: ${key}`);
              
              // For debugging, list all keys in the KV store
              const allKeys = await env.STATIC_CONTENT_KV.list();
              console.log(`Available keys in STATIC_CONTENT_KV:`, JSON.stringify(allKeys));
            }
          } catch (kvError) {
            console.error(`Error getting validator addresses from STATIC_CONTENT_KV:`, kvError.message);
          }
        } else {
          console.warn(`STATIC_CONTENT_KV binding not available`);
        }
        
        // If we couldn't get from STATIC_CONTENT_KV, we'll have to fall back to null addresses
        // The validator-addresses.json files should be in the KV store
        if (!validatorAddresses) {
          console.warn(`Could not find validator addresses for ${network.name} in KV store`);
          
          // For debugging purposes, let's log what keys are available in the STATIC_CONTENT_KV namespace
          if (env.STATIC_CONTENT_KV) {
            try {
              const allKeys = await env.STATIC_CONTENT_KV.list();
              console.log(`Available keys in STATIC_CONTENT_KV:`, JSON.stringify(allKeys));
            } catch (listError) {
              console.warn(`Error listing keys in STATIC_CONTENT_KV:`, listError.message);
            }
          }
          
          // We'll have to fall back to null addresses
          console.warn(`Falling back to null addresses for ${network.name}`);
        }
        
        if (validatorAddresses) {
          // Check if we need to update the KV store by comparing with existing values
          const updatedAddresses = [];
          
          for (const [url, address] of Object.entries(validatorAddresses)) {
            // Get the current value from KV
            const currentAddress = await env.HEALTH_KV.get(`validator:${url}`);
            
            console.log(`Validator address for ${url}: Current=${currentAddress}, New=${address}`);
            
            // Make sure we're storing the address as a string, not null or undefined
            const addressToStore = address ? address : "null";
            
            // Only update if the address has changed
            if (currentAddress !== addressToStore) {
              // Store with a long expiration time since validator addresses rarely change
              await env.HEALTH_KV.put(`validator:${url}`, addressToStore, { expirationTtl: 86400 }); // 1 days
              updatedAddresses.push(url);
              console.log(`Updated validator address for ${url}: ${addressToStore}`);
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
      
      console.log(`Current validator address for ${backend}: ${currentAddress}`);
      
      // Only update if the address is not already "null" (as a string)
      if (currentAddress !== "null") {
        // Store with a long expiration time since validator addresses rarely change
        await env.HEALTH_KV.put(`validator:${backend}`, "null", { expirationTtl: 86400 }); // 1 day
        updatedAddresses.push(backend);
        console.log(`Set validator address for ${backend} to "null"`);
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
 * Handle CORS preflight requests
 * @returns {Response} - A response with CORS headers
 */
function handleCors() {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(),
  });
}

/**
 * Get CORS headers for responses
 * @returns {Object} - CORS headers
 */
function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Cache-Control, X-Requested-With',
    'Access-Control-Max-Age': '86400',
  };
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