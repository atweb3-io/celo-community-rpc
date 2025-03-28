# Celo Community RPC Health Check System

This document describes the health check system implemented for the Celo Community RPC service.

## Overview

The health check system consists of two components:

1. **Passive Health Checks**: Implemented directly in the RPC proxy workers
2. **Active Health Checks**: Implemented as a separate scheduled worker

Together, these components ensure that unhealthy backends are automatically excluded from the rotation, improving the reliability and performance of the service.

## Passive Health Checks

Passive health checks are implemented in the RPC proxy workers (`mainnet/config.js`, `baklava/config.js`, and `alfajores/config.js`). They detect failures during actual user requests and mark failing backends as unhealthy.

### How Passive Health Checks Work

1. When a request is received, the worker retrieves a list of healthy backends from the KV store
2. If a backend fails to respond or returns an error, it is marked as unhealthy in the KV store
3. Unhealthy backends are excluded from the rotation for a cooldown period (5 minutes)
4. After the cooldown period, the backend is automatically reinstated

### Types of Failures Detected

- HTTP errors (non-200 responses)
- Timeouts (requests that take too long to complete)
- RPC-level errors that indicate health issues (e.g., node syncing, out of memory)

## Active Health Checks

Active health checks are implemented as a separate scheduled worker (`health-check-worker.js`). This worker runs on a schedule and proactively checks the health of all backends.

### How Active Health Checks Work

1. The worker runs every 5 minutes (configurable in `health-check-worker-wrangler.toml`)
2. For each backend in each network, it performs the following checks:
   - If the backend is already marked as down, it checks if it has recovered
   - If the backend is healthy, it removes it from the down list
   - If the backend is unhealthy, it marks it as down in the KV store
3. The worker logs the results of the health checks

### Health Check HTTP Endpoint

The health check worker also provides an HTTP endpoint that returns the current health status of all backends. You can access this endpoint by visiting:

```
https://health.celo-community.org/
```

The response is a JSON object with the following structure:

```json
{
  "timestamp": "2025-03-05T16:40:00.000Z",
  "networks": {
    "mainnet": {
      "healthy": [
        {
          "url": "https://forno.celo.org",
          "blockHeight": 12345678,
          "lastChecked": "2025-03-05T16:35:00.000Z",
          "validatorAddress": "0x1234567890abcdef1234567890abcdef12345678"
        }
      ],
      "unhealthy": [
        {
          "url": "https://unhealthy-backend.example.com",
          "blockHeight": null,
          "lastChecked": "2025-03-05T16:35:00.000Z",
          "validatorAddress": "0xabcdef1234567890abcdef1234567890abcdef12",
          "reason": "HTTP error: 502"
        }
      ]
    },
    "baklava": {
      "healthy": [
        {
          "url": "https://baklava-forno.celo-testnet.org",
          "blockHeight": 9876543,
          "lastChecked": "2025-03-05T16:35:00.000Z",
          "validatorAddress": "0x2345678901abcdef2345678901abcdef23456789"
        }
      ],
      "unhealthy": []
    },
    "alfajores": {
      "healthy": [
        {
          "url": "https://alfajores-forno.celo-testnet.org",
          "blockHeight": 8765432,
          "lastChecked": "2025-03-05T16:35:00.000Z",
          "validatorAddress": "0x3456789012abcdef3456789012abcdef34567890"
        }
      ],
      "unhealthy": []
    }
  }
}
```

The response includes the following information for each backend:

- `url`: The URL of the RPC endpoint
- `blockHeight`: The current block height of the node (null if unavailable)
- `lastChecked`: The timestamp of the last health check for this backend
- `validatorAddress`: The blockchain address of the validator operating this RPC endpoint (null if unavailable)
- `reason`: The reason why the backend is marked as unhealthy (only for unhealthy backends)

Note: Validator addresses are obtained from the validator-addresses.json files generated by the update-rpc-servers.js script. If these files are not available or if a URL doesn't have a corresponding validator address, the validatorAddress field will be null.

This endpoint is useful for monitoring the health of the backends and can be integrated with monitoring systems.

### Health Check Criteria

The active health check performs the following checks:

1. **Sync Status Check**: Calls `eth_syncing` to check if the node is fully synced
2. **Block Number Check**: Calls `eth_blockNumber` to ensure the node is not stale

A backend is considered healthy if:
- It responds within the timeout period (5 seconds)
- It returns a 200 OK response
- It is fully synced (not in the process of syncing)
- It returns a valid block number

## KV Store

Both passive and active health checks use the same KV store to track backend health status. The KV store is configured in the wrangler.toml files for each worker.

### KV Store Structure

- Keys: `down:{backend_url}` (e.g., `down:https://forno.celo.org`)
- Values: Reason for marking the backend as unhealthy
- TTL: 5 minutes (300 seconds)

## Deployment

To deploy the health check system:

1. Create a KV namespace in the Cloudflare dashboard
2. Add the KV namespace ID to the wrangler.toml files for all workers
3. Deploy the RPC proxy workers and the health check worker

```bash
# Deploy RPC proxy workers
cd mainnet
wrangler publish

cd ../baklava
wrangler publish

cd ../alfajores
wrangler publish

# Deploy health check worker
cd ..
wrangler publish -c health-check-worker-wrangler.toml
```

## Monitoring

The health check system logs information about backend health status. You can monitor these logs in the Cloudflare dashboard.

Key metrics to monitor:
- Number of healthy backends
- Number of unhealthy backends
- Reasons for marking backends as unhealthy
- Recovery time for unhealthy backends

## Testing

### Local Testing Limitations

The health check system relies on Cloudflare KV to track backend health status. When testing locally, the KV namespace is not available, so the health check system will not work as expected. The test script (`test-health-checks.js`) will show that backends are not excluded from rotation after simulating a failure:

```bash
npm run test:health-checks
```

This is expected behavior in a local environment. The test is still useful for verifying that the RPC endpoints are working and that the load balancing is functioning correctly.

### Testing in Production

To properly test the health check system, you need to deploy it to Cloudflare and configure the KV namespace. Once deployed, you can test it by:

1. Sending requests to the RPC endpoints
2. Monitoring the Cloudflare logs to see if backends are being marked as unhealthy
3. Verifying that unhealthy backends are excluded from rotation

You can also use the Cloudflare dashboard to view the KV namespace and check if backends are being marked as unhealthy.

## Configuration

The health check system can be configured by modifying the following constants:

- `REQUEST_TIMEOUT_MS`: Timeout for RPC requests (default: 30 seconds)
- `HEALTH_CHECK_TIMEOUT_MS`: Timeout for health check requests (default: 10 seconds)
- `HEALTH_CHECK_COOLDOWN_MS`: Cooldown period for unhealthy backends (default: 15 minutes)
- `MAX_RETRIES`: Maximum number of retries for failed requests (default: 2)
- `KV_CACHE_TTL_SECONDS`: Cache TTL for KV values that don't change often (default: 1 hour)

These constants can be found in the respective configuration files.

## Performance Optimizations

The health check system includes several optimizations to minimize KV operations and improve performance:

1. **Longer Health Check Interval**: The health check worker runs every 15 minutes instead of every 5 minutes, reducing the number of health checks performed.

2. **Longer Cooldown Period**: Unhealthy backends are marked as down for 15 minutes instead of 5 minutes, reducing the frequency of status changes.

3. **KV Caching**: Validator addresses are cached for 1 hour, reducing the number of KV reads required.

4. **KV Expiration**: Validator addresses are stored with a 1-day expiration, automatically cleaning up stale data.

5. **Increased Timeout**: Health check timeout is set to 10 seconds instead of 5 seconds, giving backends more time to respond.

6. **Multi-level Caching Strategy**: The health check endpoint implements a comprehensive multi-level caching strategy:
   - **Cloudflare Cache API**: Leverages Cloudflare's global CDN for edge caching
     - Responses are cached at the edge for 5 minutes using `s-maxage=300`
     - Cache is directly purged using the Cache API during scheduled health checks
     - Cache is also purged immediately when a backend is marked as unhealthy by an RPC worker
     - No external API calls required for cache management
   - **KV Store Caching**: Provides a fallback when edge cache misses occur
     - The entire health status response is cached in KV for 5 minutes
     - Only a single "served" timestamp is updated on each request
     - KV cache is refreshed during scheduled health checks (every 15 minutes)
   - **HTTP Cache Headers**: Enable browser and proxy caching
     - ETag and Last-Modified headers for conditional requests
     - 304 Not Modified responses for unchanged content
     - Vary headers to handle different encodings and origins
   - **Client-side Features**:
     - Cache bypass option with `Cache-Control: no-cache` header
     - UI clearly shows data timestamp and fetch time
     - Cache status is indicated in the UI with Cloudflare's CF-Cache-Status header

These optimizations help reduce the number of KV operations and improve the overall performance of the health check system while maintaining a good balance between data freshness and efficiency.

### Caching Strategy

The caching strategy is designed to find a middle ground between always having the most current health status and reducing the number of KV reads:

1. **Server-side Caching**: The health check endpoint sets Cache-Control headers with a 5-minute TTL, which is shorter than the 15-minute health check interval. This ensures that clients get reasonably fresh data while reducing load on the KV store.

2. **Client-side Caching**: The frontend respects these cache headers and will use cached responses when available. The UI shows when data is coming from cache.

3. **Force Refresh Option**: Users can force a refresh by clicking the refresh button, which bypasses the cache and gets the latest data directly from the KV store.

This approach significantly reduces KV reads while still providing timely health status information.