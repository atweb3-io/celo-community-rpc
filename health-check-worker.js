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
    
    // Check if KV store is available
    if (env && env.HEALTH_KV) {
      try {
        // Clear the cached health status in KV to force regeneration
        await env.HEALTH_KV.delete('health_status_cache');
        console.log('Cleared KV cached health status');
        
        // Update the health status timestamp when running the scheduled check
        // This timestamp will be used as the official timestamp for the health data
        const newTimestamp = new Date().toISOString();
        await env.HEALTH_KV.put('health_status_timestamp', newTimestamp);
        console.log(`Updated health status timestamp to ${newTimestamp}`);
      } catch (error) {
        console.error('Error updating KV store:', error);
      }
    } else {
      console.warn('HEALTH_KV binding not available, skipping KV operations');
    }
    
    // Run the health checks
    await checkAllBackends(env);
    
    // Generate and cache a new health status after checks are complete
    const results = await getHealthStatus(env);
    console.log('Generated new health status cache');
    
    // Instead of trying to purge the cache via API, we'll use the Cache API directly
    try {
      // Get the Cloudflare cache
      const cache = caches.default;
      
      if (cache) {
        // Create a cache key for the health endpoint
        const cacheUrl = new URL('https://health.celo-community.org/');
        const cacheKey = new Request(cacheUrl.toString());
        
        // Delete the cache entry
        const deleted = await cache.delete(cacheKey);
        if (deleted) {
          console.log('Successfully purged Cloudflare cache for health endpoint');
        } else {
          console.log('No cache entry found to purge for health endpoint');
        }
      } else {
        console.log('Cloudflare cache not available, skipping cache purge');
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
    const ifNoneMatch = request.headers.get('If-None-Match');
    const ifModifiedSince = request.headers.get('If-Modified-Since');
    
    // Determine if this is a force refresh request
    // Only consider it a force refresh if it explicitly has no-cache
    const noCache = cacheControl && cacheControl.includes('no-cache');
    
    // Calculate cache TTL - shorter than the health check interval
    // Health check runs every 15 minutes, so cache for 5 minutes
    const CACHE_TTL_SECONDS = 300; // 5 minutes
    
    // Construct the cache key from the request URL
    const cacheUrl = new URL(request.url);
    // Create a clean cache key without headers that might affect caching
    const cacheKey = new Request(cacheUrl.toString());
    
    // Try to get the Cloudflare cache
    let cachedResponse = null;
    
    // Only try to use the cache if this is not a force refresh request
    if (!noCache) {
      try {
        // Get the Cloudflare cache
        const cache = caches.default;
        
        if (cache) {
          // Try to get the response from Cloudflare's cache
          cachedResponse = await cache.match(cacheKey);
          
          if (cachedResponse) {
            console.log(`Cache hit for: ${request.url}`);
            
            // Handle conditional requests (If-None-Match, If-Modified-Since)
            if (ifNoneMatch || ifModifiedSince) {
              const cachedEtag = cachedResponse.headers.get('ETag');
              const cachedLastModified = cachedResponse.headers.get('Last-Modified');
              
              // If ETag matches, return 304 Not Modified
              if (ifNoneMatch && cachedEtag && ifNoneMatch === cachedEtag) {
                return new Response(null, {
                  status: 304,
                  headers: {
                    'ETag': cachedEtag,
                    'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
                    ...getCorsHeaders(),
                    'Last-Modified': cachedLastModified || new Date().toUTCString()
                  }
                });
              }
              
              // If Last-Modified matches, return 304 Not Modified
              if (ifModifiedSince && cachedLastModified) {
                const ifModifiedSinceDate = new Date(ifModifiedSince);
                const lastModifiedDate = new Date(cachedLastModified);
                
                if (ifModifiedSinceDate >= lastModifiedDate) {
                  return new Response(null, {
                    status: 304,
                    headers: {
                      'ETag': cachedEtag || `"${new Date().toISOString()}"`,
                      'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
                      ...getCorsHeaders(),
                      'Last-Modified': cachedLastModified
                    }
                  });
                }
              }
            }
            
            // Return the cached response
            return cachedResponse;
          }
          
          console.log(`Cache miss for: ${request.url}`);
        } else {
          console.log(`Cloudflare cache not available`);
        }
      } catch (error) {
        console.error(`Error accessing Cloudflare cache:`, error);
      }
    } else {
      console.log(`Bypassing cache for: ${request.url} due to no-cache header`);
    }
    
    // Get the current health status from our KV store
    const results = await getHealthStatus(env);
    
    // Create ETag from the timestamp
    const etag = `"${results.timestamp}"`;
    const lastModified = new Date(results.timestamp).toUTCString();
    
    // Create a new response with appropriate headers
    const response = new Response(JSON.stringify(results, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        ...getCorsHeaders(),
        'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`, // Both browser and CDN caching
        'ETag': etag,
        'Last-Modified': lastModified,
        'Vary': 'Accept-Encoding, Origin', // Vary header to ensure proper caching with different encodings
      },
    });
    
    // Store the response in Cloudflare's cache, but only if not a force refresh request
    if (!noCache) {
      try {
        const cache = caches.default;
        if (cache) {
          // Use a clean cache key (without headers) for consistent caching
          const cleanCacheKey = new Request(cacheUrl.toString());
          
          // Store in cache with waitUntil to not block the response
          ctx.waitUntil(cache.put(cleanCacheKey, response.clone()));
          console.log(`Cached response for: ${request.url}`);
        } else {
          console.warn('Cloudflare cache not available, skipping cache storage');
        }
      } catch (error) {
        console.error('Error storing response in Cloudflare cache:', error);
      }
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
  const now = new Date();
  const CACHE_TTL_SECONDS = 300; // 5 minutes
  let timestamp = now.toISOString();
  let cachedHealthStatus = null;
  
  // Check if KV store is available
  if (env && env.HEALTH_KV) {
    try {
      // Try to get the cached health status from KV
      cachedHealthStatus = await env.HEALTH_KV.get('health_status_cache', { type: 'json' });
      
      // If we have a valid cached response, return it
      if (cachedHealthStatus) {
        // Don't modify the cached response body - this would break caching
        return cachedHealthStatus;
      }
      
      // If no cached response exists, generate a new one
      console.log('No cached health status found, generating new one');
      
      // We'll calculate the timestamp based on the lastChecked values of the backends
      // This ensures the timestamp is consistent with the backend data
    } catch (error) {
      console.error('Error accessing KV store:', error);
      // Continue with default timestamp
    }
  } else {
    console.warn('HEALTH_KV binding not available, using default timestamp');
  }
  
  const results = {
    timestamp: timestamp,  // When the health data was last collected during scheduled check
    _metadata: {
      timestamp_info: "When the health data was last collected during scheduled check"
    },
    networks: {}
  };
  
  for (const network of NETWORKS) {
    results.networks[network.name] = {
      healthy: [],
      unhealthy: []
    };
    
    for (const backend of network.backends) {
      let isDown = null;
      let blockHeight = null;
      let lastChecked = null;
      let validatorAddress = null;
      
      // Only try to access KV if it's available
      if (env && env.HEALTH_KV) {
        try {
          // Check if the backend is marked as down
          isDown = await env.HEALTH_KV.get(`down:${backend}`);
          
          // Get additional information from KV store with caching for values that don't change often
          blockHeight = await env.HEALTH_KV.get(`blockHeight:${backend}`);
          lastChecked = await env.HEALTH_KV.get(`lastChecked:${backend}`);
          // Validator addresses don't change often, so we can use a longer cache TTL
          validatorAddress = await env.HEALTH_KV.get(`validator:${backend}`, { cacheTtl: KV_CACHE_TTL_SECONDS });
        } catch (error) {
          console.error(`Error getting data from KV for ${backend}:`, error);
        }
      }
      
      const reason = isDown || null;
      
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
  
  // Cache the results for 5 minutes if KV is available
  if (env && env.HEALTH_KV) {
    try {
      await env.HEALTH_KV.put('health_status_cache', JSON.stringify(results), { expirationTtl: CACHE_TTL_SECONDS });
    } catch (error) {
      console.error('Error caching health status:', error);
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
  
  // Check if KV store is available
  const isKvAvailable = env && env.HEALTH_KV;
  
  // Try to get validator addresses from celocli
  if (isKvAvailable) {
    await fetchValidatorAddresses(env);
  } else {
    console.warn('Skipping validator address fetch - KV not available');
  }
  
  for (const network of NETWORKS) {
    console.log(`Checking backends for ${network.name}...`);
    
    for (const backend of network.backends) {
      try {
        let isDown = null;
        
        // Only check KV if it's available
        if (isKvAvailable) {
          try {
            // Check if the backend is already marked as down
            isDown = await env.HEALTH_KV.get(`down:${backend}`);
          } catch (kvError) {
            console.error(`Error checking if backend is down: ${kvError.message}`);
          }
        }
        
        if (isDown) {
          console.log(`Backend ${backend} is currently marked as down, checking if it has recovered`);
          
          // Check if the backend has recovered
          const isHealthy = await checkBackendHealth(backend, env);
          if (isHealthy && isKvAvailable) {
            try {
              // If the backend has recovered, remove it from the down list
              await env.HEALTH_KV.delete(`down:${backend}`);
              console.log(`Backend ${backend} has recovered, removed from down list`);
            } catch (kvError) {
              console.error(`Error removing backend from down list: ${kvError.message}`);
            }
          } else {
            console.log(`Backend ${backend} is still unhealthy`);
          }
          
          results.push({ network: network.name, backend, healthy: isHealthy, wasDown: true });
          continue;
        }
        
        // Perform health check
        const isHealthy = await checkBackendHealth(backend, env);
        results.push({ network: network.name, backend, healthy: isHealthy, wasDown: false });
        
        if (!isHealthy && isKvAvailable) {
          try {
            // Mark as unhealthy for 15 minutes
            await env.HEALTH_KV.put(`down:${backend}`, 'Failed active health check', { expirationTtl: HEALTH_CHECK_COOLDOWN_MS / 1000 });
            console.error(`Active check: Backend ${backend} marked as unhealthy`);
          } catch (kvError) {
            console.error(`Error marking backend as unhealthy: ${kvError.message}`);
          }
        }
      } catch (error) {
        console.error(`Error checking backend ${backend}: ${error.message}`);
        results.push({ network: network.name, backend, healthy: false, error: error.message });
        
        if (isKvAvailable) {
          try {
            // Mark as unhealthy for 15 minutes
            await env.HEALTH_KV.put(`down:${backend}`, `Error: ${error.message}`, { expirationTtl: HEALTH_CHECK_COOLDOWN_MS / 1000 });
          } catch (kvError) {
            console.error(`Error marking backend as unhealthy: ${kvError.message}`);
          }
        }
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
  
  // Check if KV stores are available
  const isHealthKvAvailable = env && env.HEALTH_KV;
  const isStaticContentKvAvailable = env && env.STATIC_CONTENT_KV;
  
  if (!isHealthKvAvailable) {
    console.warn('HEALTH_KV binding not available, skipping validator address fetch');
    return;
  }
  
  if (!isStaticContentKvAvailable) {
    console.warn('STATIC_CONTENT_KV binding not available, skipping validator address fetch');
    return;
  }
  
  for (const network of NETWORKS) {
    try {
      console.log(`Fetching validator addresses for ${network.name}...`);
      
      // Try to fetch the validator addresses from the KV store directly
      try {
        // Check if we have the validator addresses in the KV store
        const kvKey = `${network.name}/validator-addresses`;
        let validatorAddresses = null;
        
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
            try {
              const allKeys = await env.STATIC_CONTENT_KV.list();
              console.log(`Available keys in STATIC_CONTENT_KV:`, JSON.stringify(allKeys));
            } catch (listError) {
              console.warn(`Error listing keys in STATIC_CONTENT_KV:`, listError.message);
            }
          }
        } catch (kvError) {
          console.error(`Error getting validator addresses from STATIC_CONTENT_KV:`, kvError.message);
        }
        
        // If we couldn't get from STATIC_CONTENT_KV, we'll have to fall back to null addresses
        if (!validatorAddresses) {
          console.warn(`Could not find validator addresses for ${network.name} in KV store`);
          console.warn(`Falling back to null addresses for ${network.name}`);
        }
        
        if (validatorAddresses) {
          // Check if we need to update the KV store by comparing with existing values
          const updatedAddresses = [];
          
          for (const [url, address] of Object.entries(validatorAddresses)) {
            try {
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
            } catch (kvError) {
              console.error(`Error updating validator address for ${url}:`, kvError.message);
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
  
  // Check if KV store is available
  const isKvAvailable = env && env.HEALTH_KV;
  
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
      if (isKvAvailable) {
        try {
          await env.HEALTH_KV.put(`lastChecked:${backend}`, now);
        } catch (kvError) {
          console.error(`Error updating lastChecked: ${kvError.message}`);
        }
      }
      return false;
    }
    
    const data = await response.json();
    
    // Check if the node is syncing
    // If result is false, the node is fully synced
    // If result is an object, the node is still syncing
    if (data.error) {
      console.error(`Health check failed for ${backend}: RPC error: ${data.error.message}`);
      // Update last checked time even if unhealthy
      if (isKvAvailable) {
        try {
          await env.HEALTH_KV.put(`lastChecked:${backend}`, now);
        } catch (kvError) {
          console.error(`Error updating lastChecked: ${kvError.message}`);
        }
      }
      return false;
    }
    
    // If the node is syncing, mark it as unhealthy
    if (data.result && typeof data.result === 'object') {
      console.log(`Backend ${backend} is still syncing`);
      // Update last checked time even if unhealthy
      if (isKvAvailable) {
        try {
          await env.HEALTH_KV.put(`lastChecked:${backend}`, now);
        } catch (kvError) {
          console.error(`Error updating lastChecked: ${kvError.message}`);
        }
      }
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
      if (isKvAvailable) {
        try {
          await env.HEALTH_KV.put(`lastChecked:${backend}`, now);
        } catch (kvError) {
          console.error(`Error updating lastChecked: ${kvError.message}`);
        }
      }
      return false;
    }
    
    const blockData = await blockNumberResponse.json();
    
    if (blockData.error) {
      console.error(`Block number check failed for ${backend}: RPC error: ${blockData.error.message}`);
      // Update last checked time even if unhealthy
      if (isKvAvailable) {
        try {
          await env.HEALTH_KV.put(`lastChecked:${backend}`, now);
        } catch (kvError) {
          console.error(`Error updating lastChecked: ${kvError.message}`);
        }
      }
      return false;
    }
    
    const blockNumber = parseInt(blockData.result, 16);
    console.log(`Backend ${backend} is at block ${blockNumber}`);
    
    // Store block height and last checked time in KV store
    if (isKvAvailable) {
      try {
        await env.HEALTH_KV.put(`blockHeight:${backend}`, blockNumber.toString());
        await env.HEALTH_KV.put(`lastChecked:${backend}`, now);
      } catch (kvError) {
        console.error(`Error updating block data: ${kvError.message}`);
      }
    }
    
    // Node is healthy
    console.log(`Backend ${backend} is healthy`);
    return true;
  } catch (error) {
    console.error(`Health check failed for ${backend}: ${error.message}`);
    // Update last checked time even if unhealthy
    if (isKvAvailable) {
      try {
        await env.HEALTH_KV.put(`lastChecked:${backend}`, now);
      } catch (kvError) {
        console.error(`Error updating lastChecked: ${kvError.message}`);
      }
    }
    return false;
  }
}