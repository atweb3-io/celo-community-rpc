// Mainnet configuration
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
  
  // Simplified approach: primarily rely on KV storage with minimal in-memory caching
  // This follows the pattern used in the health-check-worker
  
  // Check if KV is available
  if (!env) {
    console.warn('Environment object is not available, using all backends');
    return [...backendList];
  }
  
  if (!env.HEALTH_KV) {
    console.warn('HEALTH_KV binding is not available, using all backends');
    return [...backendList];
  }
  
  // Process each backend
  for (const backend of backendList) {
    try {
      // Check if the backend is marked as down in KV
      const isDown = await env.HEALTH_KV.get(`down:${backend}`);
      
      if (!isDown) {
        // Backend is not marked as unhealthy in KV, so it's healthy
        healthyBackends.push(backend);
      }
    } catch (error) {
      console.error(`Error checking KV for backend ${backend}: ${error.message}`);
      // If there's an error checking KV, assume the backend is healthy
      healthyBackends.push(backend);
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
  
  // Store in KV if available - simplified approach like health-check-worker
  if (!env) {
    console.warn(`Environment object is not available, cannot mark backend ${backend} as unhealthy`);
    return;
  }
  
  if (!env.HEALTH_KV) {
    console.warn(`HEALTH_KV binding is not available, cannot mark backend ${backend} as unhealthy`);
    return;
  }
  
  try {
    const expirationTtl = Math.floor(HEALTH_CHECK_COOLDOWN_MS / 1000);
    await env.HEALTH_KV.put(`down:${backend}`, reason, { expirationTtl });
  } catch (kvError) {
    console.error(`Error storing unhealthy backend in KV: ${kvError.message}`);
  }
  
  // Use service binding to notify health check worker if available
  if (env && env.HEALTH_CHECK_WORKER) {
    try {
      const refreshResponse = await env.HEALTH_CHECK_WORKER.fetch(
        new Request('https://health.celo-community.org/refresh')
      );
      if (refreshResponse.ok) {
        console.log('Successfully triggered health check worker refresh');
      }
    } catch (bindingError) {
      console.warn(`Error using service binding: ${bindingError.message}`);
    }
  }
}

// Removed syncUnhealthyBackendsFromKV function as part of simplification

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
 * @param {Object} env - Environment variables and bindings
 * @param {Object} ctx - Context object
 * @returns {Response} - The response to send back
 */
export async function handleRequest(request, env, ctx) {
  // Direct access to env like in health-check-worker
  
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
    'Content-Security-Policy': "default-src 'self' celo-community.org rpc.celo-community.org *.celo-community.org",
  };
}