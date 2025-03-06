// Baklava testnet configuration
import { backendList } from './rpc-servers.js';

// Constants
const REQUEST_TIMEOUT_MS = 30000; // 30 seconds
const MAX_RETRIES = 2;
const HEALTH_CHECK_COOLDOWN_MS = 300000; // 5 minutes (300 seconds)

// Round-robin index tracker
let currentBackendIndex = 0;

/**
 * Get healthy backends from the KV store
 * @param {Object} env - Environment variables and bindings
 * @returns {Promise<string[]>} - Array of healthy backend URLs
 */
async function getHealthyBackends(env) {
  const healthyBackends = [];
  
  // Use a more reliable approach for in-memory storage
  // 1. Try to use caches API if available (works in production)
  // 2. Fall back to globalThis if caches not available (works in some environments)
  // 3. Fall back to a local Map as last resort (works only for current request)
  
  let inMemoryUnhealthyBackends;
  let storageType = "none";
  
  // Try to use Cache API first (most reliable in production)
  if (typeof caches !== 'undefined') {
    try {
      const cache = caches.default;
      const cacheKey = new Request('https://internal.celo-community.org/unhealthy-backends');
      let cacheResponse = await cache.match(cacheKey);
      
      if (!cacheResponse) {
        // Initialize cache if not exists
        inMemoryUnhealthyBackends = new Map();
        storageType = "cache-new";
      } else {
        // Parse existing cache
        const cacheData = await cacheResponse.json();
        inMemoryUnhealthyBackends = new Map(Object.entries(cacheData).map(([key, value]) => [key, value]));
        storageType = "cache-existing";
      }
      
      // Function to update cache
      globalThis.updateUnhealthyBackendsCache = async (map) => {
        const cacheData = Object.fromEntries(map);
        const newResponse = new Response(JSON.stringify(cacheData), {
          headers: { 'Content-Type': 'application/json' }
        });
        await cache.put(cacheKey, newResponse);
      };
      
    } catch (cacheError) {
      console.warn(`Error using Cache API: ${cacheError.message}, falling back to globalThis`);
    }
  }
  
  // Fall back to globalThis if caches not available or failed
  if (typeof globalThis.UNHEALTHY_BACKENDS === 'undefined') {
    globalThis.UNHEALTHY_BACKENDS = new Map();
  }
  
  // Initialize with globalThis storage if we don't have a cache
  if (!inMemoryUnhealthyBackends) {
    inMemoryUnhealthyBackends = globalThis.UNHEALTHY_BACKENDS;
    storageType = "globalThis";
  }
  
  // Sync from KV to in-memory storage if KV is available
  try {
    if (env && env.HEALTH_KV) {
      await syncUnhealthyBackendsFromKV(env, inMemoryUnhealthyBackends);
    }
  } catch (syncError) {
    console.warn(`Error syncing from KV: ${syncError.message}`);
  }
  
  // Filter out backends that are marked as unhealthy
  for (const backend of backendList) {
    const unhealthyInfo = inMemoryUnhealthyBackends.get(backend);
    
    if (!unhealthyInfo) {
      // Backend is not in the unhealthy list, so it's healthy
      healthyBackends.push(backend);
      continue;
    }
    
    // Check if the cooldown period has passed
    const now = Date.now();
    const timeSinceMarked = now - unhealthyInfo.timestamp;
    
    if (timeSinceMarked > HEALTH_CHECK_COOLDOWN_MS) {
      // Cooldown period has passed, consider it healthy again
      inMemoryUnhealthyBackends.delete(backend);
      healthyBackends.push(backend);
      console.log(`Backend ${backend} cooldown period passed, marking as healthy again`);
    } else {
      // Still in cooldown period, keep it marked as unhealthy
      console.log(`Backend ${backend} still in cooldown period (${Math.round((HEALTH_CHECK_COOLDOWN_MS - timeSinceMarked) / 1000)}s remaining)`);
    }
  }
  
  // If all backends are unhealthy, use all backends as a fallback
  if (healthyBackends.length === 0) {
    console.warn('All backends are marked as unhealthy! Using all backends as fallback.');
    return [...backendList];
  }
  
  console.log(`Using ${healthyBackends.length} healthy backends out of ${backendList.length} total`);
  return healthyBackends;
}

/**
 * Mark a backend as unhealthy
 * @param {Object} env - Environment variables and bindings
 * @param {string} backend - The backend URL to mark as unhealthy
 * @param {string} reason - The reason for marking as unhealthy
 * @returns {Promise<void>}
 */
async function markBackendUnhealthy(env, backend, reason) {
  console.log(`Marking backend ${backend} as unhealthy: ${reason}`);
  
  // Store in KV if available
  if (env && env.HEALTH_KV) {
    try {
      await env.HEALTH_KV.put(`down:${backend}`, reason, { expirationTtl: Math.floor(HEALTH_CHECK_COOLDOWN_MS / 1000) });
      console.log(`Stored unhealthy backend ${backend} in KV: ${reason}`);
    } catch (kvError) {
      console.error(`Error storing unhealthy backend in KV: ${kvError.message}`);
    }
  }
  
  // Store in in-memory cache
  try {
    // Try to use Cache API first
    if (typeof caches !== 'undefined' && caches.default) {
      try {
        const cache = caches.default;
        const cacheKey = new Request('https://internal.celo-community.org/unhealthy-backends');
        let cacheResponse = await cache.match(cacheKey);
        
        let cacheData = {};
        if (cacheResponse) {
          cacheData = await cacheResponse.json();
        }
        
        cacheData[backend] = {
          reason,
          timestamp: Date.now()
        };
        
        const newResponse = new Response(JSON.stringify(cacheData), {
          headers: { 'Content-Type': 'application/json' }
        });
        
        await cache.put(cacheKey, newResponse);
        console.log(`Stored unhealthy backend ${backend} in cache: ${reason}`);
      } catch (cacheError) {
        console.warn(`Error using Cache API: ${cacheError.message}, falling back to globalThis`);
      }
    }
    
    // Fall back to globalThis
    if (typeof globalThis.UNHEALTHY_BACKENDS === 'undefined') {
      globalThis.UNHEALTHY_BACKENDS = new Map();
    }
    
    globalThis.UNHEALTHY_BACKENDS.set(backend, {
      reason,
      timestamp: Date.now()
    });
    
    console.log(`Stored unhealthy backend ${backend} in globalThis storage: ${reason}`);
  } catch (error) {
    console.error(`Error marking backend as unhealthy: ${error.message}`);
  }
  
  // Purge health cache to ensure health status page is updated
  await purgeHealthCache(env);
}

/**
 * Sync unhealthy backends from KV to in-memory cache
 * @param {Object} env - Environment variables and bindings
 * @param {Map} inMemoryStorage - The in-memory storage to update
 * @returns {Promise<void>}
 */
async function syncUnhealthyBackendsFromKV(env, inMemoryStorage) {
  if (!env || !env.HEALTH_KV) return;
  if (!inMemoryStorage) {
    console.warn('No in-memory storage provided for syncUnhealthyBackendsFromKV');
    return;
  }
  
  try {
    // Get all keys with prefix "down:"
    const listResult = await env.HEALTH_KV.list({ prefix: 'down:' });
    
    if (listResult && listResult.keys && listResult.keys.length > 0) {
      // Update in-memory cache
      for (const key of listResult.keys) {
        const backend = key.name.replace('down:', '');
        const reason = await env.HEALTH_KV.get(key.name);
        
        if (reason) {
          inMemoryStorage.set(backend, {
            reason,
            timestamp: Date.now()
          });
          console.log(`Synced unhealthy backend from KV to memory: ${backend}`);
        }
      }
      
      // Update cache if we're using Cache API
      if (typeof globalThis.updateUnhealthyBackendsCache === 'function') {
        await globalThis.updateUnhealthyBackendsCache(inMemoryStorage);
      }
      
      console.log(`Synced ${listResult.keys.length} unhealthy backends from KV to memory`);
    } else {
      console.log('No unhealthy backends found in KV');
    }
  } catch (error) {
    console.error('Error syncing unhealthy backends from KV:', error);
    throw error; // Re-throw to allow caller to handle
  }
}

/**
 * Purge the health endpoint cache
 * @param {Object} env - Environment variables and bindings
 * @returns {Promise<void>}
 */
async function purgeHealthCache(env) {
  try {
    // Check if we're in a Cloudflare Worker environment with cache API
    if (typeof caches !== 'undefined' && caches.default) {
      try {
        // Purge the health endpoint cache
        const cache = caches.default;
        const cacheUrl = new URL('https://health.celo-community.org/');
        const cacheKey = new Request(cacheUrl.toString());
        
        // Try to delete the cache entry
        const deleted = await cache.delete(cacheKey);
        
        if (deleted) {
          console.log('Successfully purged health endpoint cache due to backend failure');
        } else {
          console.log('No cache entry found to purge for health endpoint');
        }
        
        // Also try to purge using fetch with cache-control: no-cache
        try {
          const purgeResponse = await fetch(cacheUrl.toString(), {
            method: 'GET',
            headers: {
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache'
            }
          });
          
          if (purgeResponse.ok) {
            console.log('Sent cache-busting request to health endpoint');
          }
        } catch (fetchError) {
          console.warn('Error sending cache-busting request:', fetchError.message);
        }
        
        // If health check worker service binding is available, use it
        if (env && env.HEALTH_CHECK_WORKER) {
          try {
            const refreshResponse = await env.HEALTH_CHECK_WORKER.fetch(new Request('https://health.celo-community.org/refresh'));
            if (refreshResponse.ok) {
              console.log('Successfully triggered health check worker refresh');
            }
          } catch (bindingError) {
            console.warn('Error using service binding:', bindingError.message);
          }
        }
      } catch (cacheError) {
        console.warn('Error accessing Cloudflare cache:', cacheError.message);
      }
    } else {
      console.warn('Cloudflare cache API not available, skipping cache purge');
    }
  } catch (error) {
    // Non-critical error, just log it
    console.error('Error purging health status cache:', error);
  }
}

/**
 * Check if an RPC error indicates a health issue
 * @param {Object} error - The RPC error object
 * @returns {boolean} - Whether the error indicates a health issue
 */
function isHealthRelatedError(error) {
  if (!error || !error.message) {
    return false;
  }
  
  // Check for specific error messages that indicate node health issues
  const unhealthyErrorPatterns = [
    /syncing/i,
    /database.*compact/i,
    /out of memory/i,
    /not ready/i,
    /timeout/i,
    /timed? out/i,
    /connection refused/i,
    /ECONNABORTED/i,
    /network error/i
  ];
  
  return unhealthyErrorPatterns.some(pattern =>
    pattern.test(error.message)
  );
}

/**
 * Get the next backend in round-robin fashion
 * @param {string[]} backends - List of backends to choose from
 * @returns {string} - The next backend URL
 */
function getNextBackend(backends = backendList) {
  if (!backends || backends.length === 0) {
    return backendList[currentBackendIndex];
  }
  
  const index = currentBackendIndex % backends.length;
  currentBackendIndex = (currentBackendIndex + 1) % backends.length;
  return backends[index];
}

/**
 * Handle JSON-RPC requests in a way compatible with Ethereum's geth
 * @param {Request} request - The incoming request
 * @param {Object} event - The fetch event object containing environment bindings
 * @returns {Response} - The response to send back
 */
export async function handleRequest(request, event) {
  // Extract environment bindings from the event object
  const env = event && event.env ? event.env : {};
  
  // Apply rate limiting based on client IP if rate limiter is available
  if (env && env.MY_RATE_LIMITER) {
    const ipAddress = request.headers.get("cf-connecting-ip") || "";
    if (ipAddress) {
      try {
        const { success } = await env.MY_RATE_LIMITER.limit({ key: ipAddress });
        if (!success) {
          return jsonRpcError(
            null,
            -32429,
            `Rate limit exceeded for IP: ${ipAddress}`,
            429
          );
        }
      } catch (error) {
        // Log rate limiting error but continue processing the request
        console.error(`Rate limiting error: ${error.message}`);
      }
    }
  }

  // Handle preflight OPTIONS request for CORS
  if (request.method === 'OPTIONS') {
    return handleCors();
  }

  // Handle health check requests
  if (request.method === 'GET') {
    return new Response(JSON.stringify({ status: 'ok' }), {
      headers: {
        'Content-Type': 'application/json',
        ...getCorsHeaders(),
      },
    });
  }

  // Only accept POST requests for JSON-RPC
  if (request.method !== 'POST') {
    return jsonRpcError(
      null,
      -32600,
      'Invalid Request: Method not allowed',
      405
    );
  }

  let requestBody;
  try {
    // Parse the request body as JSON
    requestBody = await request.json();
  } catch (error) {
    return jsonRpcError(null, -32700, 'Parse error', 400);
  }

  // Handle batch requests
  if (Array.isArray(requestBody)) {
    return handleBatchRequest(requestBody, env);
  }

  // Handle single request
  return handleSingleRequest(requestBody, env);
}

/**
 * Handle a single JSON-RPC request
 * @param {Object} requestBody - The parsed JSON-RPC request
 * @param {Object} env - Environment variables and bindings
 * @returns {Response} - The response to send back
 */
async function handleSingleRequest(requestBody, env) {
  // Validate JSON-RPC request format
  if (!isValidJsonRpcRequest(requestBody)) {
    return jsonRpcError(
      requestBody.id || null,
      -32600,
      'Invalid Request: Not a valid JSON-RPC 2.0 request',
      400
    );
  }

  // Get list of healthy backends
  const healthyBackends = await getHealthyBackends(env);
  
  // Try to forward the request with retries
  let lastError = null;
  let attemptedBackends = new Set();
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Select a backend that hasn't been tried yet
    let target;
    let availableBackends = healthyBackends.filter(backend => !attemptedBackends.has(backend));
    
    if (availableBackends.length === 0) {
      // If we've tried all healthy backends, break out of the loop
      if (attemptedBackends.size >= healthyBackends.length) {
        break;
      }
      // Otherwise, reset and try again (shouldn't happen in normal operation)
      availableBackends = [...healthyBackends];
    }
    
    // Get the next backend
    target = getNextBackend(availableBackends);
    attemptedBackends.add(target);
    
    try {
      // Forward the request to the selected Celo Alfajores testnet RPC endpoint
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      
      const response = await fetch(target, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      // Check if the response is successful
      if (!response.ok) {
        // Mark this backend as unhealthy
        await markBackendUnhealthy(env, target, `HTTP error: ${response.status}`);
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      
      // Get the response body
      const responseBody = await response.json();
      
      // Check for RPC-level errors that might indicate an unhealthy node
      if (responseBody.error && isHealthRelatedError(responseBody.error)) {
        // Mark this backend as unhealthy
        await markBackendUnhealthy(env, target, `RPC error: ${responseBody.error.message}`);
        throw new Error(`RPC error: ${responseBody.error.message}`);
      }
      
      // Log which backend was used for this request
      console.log(`Request ${requestBody.id || 'unknown'} method ${requestBody.method} served by backend: ${target}`);
      
      // Return the response with CORS headers and backend server info
      return new Response(JSON.stringify(responseBody), {
        headers: {
          'Content-Type': 'application/json',
          'X-Backend-Server': target,
          ...getCorsHeaders(),
        },
      });
    } catch (error) {
      lastError = error;
      console.error(`Error with backend ${target}: ${error.message}`);
      
      // Continue to the next backend if we haven't exhausted all retries
      if (attempt < MAX_RETRIES) {
        continue;
      }
    }
  }
  
  // If we get here, all retries failed
  return jsonRpcError(
    requestBody.id || null,
    -32603,
    `Internal error: ${lastError ? lastError.message : 'All backends failed'}`,
    500
  );
}

/**
 * Handle a batch of JSON-RPC requests
 * @param {Array} requests - Array of JSON-RPC request objects
 * @param {Object} env - Environment variables and bindings
 * @returns {Response} - The response to send back
 */
async function handleBatchRequest(requests, env) {
  // Check if the batch is empty
  if (requests.length === 0) {
    return jsonRpcError(null, -32600, 'Invalid Request: Empty batch', 400);
  }
  
  // Get list of healthy backends
  const healthyBackends = await getHealthyBackends(env);
  
  // Track which backends were used
  const usedBackends = new Set();
  
  // Process each request in the batch
  const responses = await Promise.all(
    requests.map(async (request) => {
      // Skip invalid requests in batch
      if (!isValidJsonRpcRequest(request)) {
        return {
          jsonrpc: '2.0',
          id: request.id || null,
          error: {
            code: -32600,
            message: 'Invalid Request',
          },
        };
      }
      
      try {
        // Select a backend from healthy backends
        const target = getNextBackend(healthyBackends);
        // Add to the set of used backends
        usedBackends.add(target);
        
        // Forward the request to the selected Celo Alfajores testnet RPC endpoint
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        
        const response = await fetch(target, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          // Mark this backend as unhealthy
          await markBackendUnhealthy(env, target, `HTTP error: ${response.status}`);
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        const responseBody = await response.json();
        
        // Check for RPC-level errors that might indicate an unhealthy node
        if (responseBody.error && isHealthRelatedError(responseBody.error)) {
          // Mark this backend as unhealthy
          await markBackendUnhealthy(env, target, `RPC error: ${responseBody.error.message}`);
          throw new Error(`RPC error: ${responseBody.error.message}`);
        }
        
        return responseBody;
      } catch (error) {
        console.error(`Batch request error: ${error.message}`);
        return {
          jsonrpc: '2.0',
          id: request.id || null,
          error: {
            code: -32603,
            message: `Internal error: ${error.message}`,
          },
        };
      }
    })
  );
  
  // Log which backends were used for this batch request
  const backendsUsed = Array.from(usedBackends);
  console.log(`Batch request with ${requests.length} operations served by backends: ${backendsUsed.join(', ')}`);
  
  // Return the batch response with backend server info
  return new Response(JSON.stringify(responses), {
    headers: {
      'Content-Type': 'application/json',
      'X-Backend-Servers': backendsUsed.join(', '),
      ...getCorsHeaders(),
    },
  });
}

/**
 * Check if a request is a valid JSON-RPC 2.0 request
 * @param {Object} request - The request object to validate
 * @returns {boolean} - Whether the request is valid
 */
function isValidJsonRpcRequest(request) {
  return (
    request &&
    typeof request === 'object' &&
    request.jsonrpc === '2.0' &&
    typeof request.method === 'string' &&
    (request.params === undefined ||
      Array.isArray(request.params) ||
      typeof request.params === 'object') &&
    (request.id === undefined ||
      typeof request.id === 'string' ||
      typeof request.id === 'number' ||
      request.id === null)
  );
}

/**
 * Create a JSON-RPC error response
 * @param {string|number|null} id - The request ID
 * @param {number} code - The error code
 * @param {string} message - The error message
 * @param {number} status - The HTTP status code
 * @returns {Response} - The error response
 */
function jsonRpcError(id, code, message, status = 400) {
  const errorResponse = {
    jsonrpc: '2.0',
    id: id,
    error: {
      code: code,
      message: message,
    },
  };
  
  return new Response(JSON.stringify(errorResponse), {
    status: status,
    headers: {
      'Content-Type': 'application/json',
      ...getCorsHeaders(),
    },
  });
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
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}