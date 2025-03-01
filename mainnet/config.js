// Mainnet configuration
import { backendList } from './rpc-servers.js';

// Constants
const REQUEST_TIMEOUT_MS = 30000; // 30 seconds
const MAX_RETRIES = 2;

// Round-robin index tracker
let currentBackendIndex = 0;

/**
 * Get the next backend in round-robin fashion
 * @returns {string} - The next backend URL
 */
function getNextBackend() {
  const backend = backendList[currentBackendIndex];
  currentBackendIndex = (currentBackendIndex + 1) % backendList.length;
  return backend;
}

/**
 * Handle JSON-RPC requests in a way compatible with Ethereum's geth
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment variables and bindings
 * @returns {Response} - The response to send back
 */
export async function handleRequest(request, env) {
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
    return handleBatchRequest(requestBody);
  }

  // Handle single request
  return handleSingleRequest(requestBody);
}

/**
 * Handle a single JSON-RPC request
 * @param {Object} requestBody - The parsed JSON-RPC request
 * @returns {Response} - The response to send back
 */
async function handleSingleRequest(requestBody) {
  // Validate JSON-RPC request format
  if (!isValidJsonRpcRequest(requestBody)) {
    return jsonRpcError(
      requestBody.id || null,
      -32600,
      'Invalid Request: Not a valid JSON-RPC 2.0 request',
      400
    );
  }

  // Select a backend using round-robin strategy
  let target = getNextBackend();
  
  // Try to forward the request with retries
  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Forward the request to the selected Celo mainnet RPC endpoint
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
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      
      // Get the response body
      const responseBody = await response.json();
      
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
      // If this was the last retry, we'll fall through to the error handler
      if (attempt < MAX_RETRIES) {
        // Try a different backend for the next attempt
        const newIndex = (backendList.indexOf(target) + 1) % backendList.length;
        target = backendList[newIndex];
      }
    }
  }
  
  // If we get here, all retries failed
  return jsonRpcError(
    requestBody.id || null,
    -32603,
    `Internal error: ${lastError.message}`,
    500
  );
}

/**
 * Handle a batch of JSON-RPC requests
 * @param {Array} requests - Array of JSON-RPC request objects
 * @returns {Response} - The response to send back
 */
async function handleBatchRequest(requests) {
  // Check if the batch is empty
  if (requests.length === 0) {
    return jsonRpcError(null, -32600, 'Invalid Request: Empty batch', 400);
  }
  
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
        // Select a backend using round-robin strategy
        const target = getNextBackend();
        // Add to the set of used backends
        usedBackends.add(target);
        
        // Forward the request to the selected Celo mainnet RPC endpoint
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
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        return await response.json();
      } catch (error) {
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