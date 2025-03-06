# Celo Community RPC Gateway

Mainnet:
```
rpc.celo-community.org
```

Baklava:
```
baklava-rpc.celo-community.org
```

Alfajores:
```
alfajores-rpc.celo-community.org
```


This repository contains Cloudflare Workers that serve as reverse proxies for Celo blockchain RPC endpoints. The workers distribute requests across multiple backend RPC nodes to improve reliability and performance.


## Repository Structure

The repository is organized by network, with each network having its own directory:

```
celo-community-rpc/
├── .github/
│   └── workflows/
│       ├── deploy-workers.yml       # Workflow for deploying workers
│       ├── deploy-github-pages.yml  # Workflow for deploying the website
│       └── update-rpc-servers.yml   # Workflow for updating RPC servers
├── mainnet/                         # Mainnet RPC proxy
│   ├── config.js                    # Main request handling logic
│   ├── index.js                     # Worker entry point
│   ├── rpc-servers.js               # RPC endpoint configuration
│   └── wrangler.toml                # Cloudflare Worker configuration
├── baklava/                         # Baklava testnet RPC proxy
│   ├── config.js
│   ├── index.js
│   ├── rpc-servers.js
│   └── wrangler.toml
├── alfajores/                       # Alfajores testnet RPC proxy
│   ├── config.js
│   ├── index.js
│   ├── rpc-servers.js
│   └── wrangler.toml
├── public/                          # Website files
│   ├── index.html                   # Main HTML file
│   ├── styles.css                   # CSS styles
│   ├── script.js                    # JavaScript for interactivity
│   └── favicon.svg                  # Website favicon
├── health-check-worker.js           # Active health check worker
├── health-check-worker-wrangler.toml # Configuration for health check worker
├── HEALTH-CHECK-README.md           # Documentation for health check system
├── test-health-checks.js            # Test script for health checks
├── update-rpc-servers.js            # Script to update RPC servers
└── package.json                     # Project dependencies
```

## Configuration

Each network directory contains the following files:

- `index.js`: The entry point for the Cloudflare Worker, which imports and uses the `handleRequest` function from `config.js`.
- `config.js`: Contains the main logic for handling RPC requests, including request validation, forwarding to backends, error handling, and CORS. It imports the `backendList` from `rpc-servers.js`.
- `rpc-servers.js`: Contains the list of backend RPC endpoints. This file can be updated by "celcli call" to fetch registered RPC servers and check their health.
- `wrangler.toml`: Cloudflare Worker configuration file.

The worker uses a round-robin strategy to select endpoints from the `backendList` for each request, providing load balancing and failover capabilities. If a request fails, the worker will retry with a different endpoint.

## Deployment

### GitHub Actions

This repository uses GitHub Actions to automatically deploy the workers to Cloudflare. The workflow is defined in `deploy-workers.yml`.

### Required GitHub Secrets

To deploy the workers, you need to set up the following GitHub secrets:

1. `CLOUDFLARE_API_TOKEN`: Your Cloudflare API token with Worker deployment permissions
2. `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare account ID
3. `CLOUDFLARE_ZONE_ID`: The zone ID for your domain
4. `HEALTH_KV_ID`: The ID of your Cloudflare KV namespace for health checks
5. `HEALTH_KV_PREVIEW_ID`: The preview ID of your Cloudflare KV namespace (can be the same as HEALTH_KV_ID)

For the automatic RPC server updates workflow, you also need:

6. `GH_PAT`: A GitHub Personal Access Token with `repo` scope (for creating pull requests)

#### Setting Up Health Check KV Namespace

1. Create a KV namespace in your Cloudflare dashboard:
   - Go to Workers & Pages > KV
   - Click "Create namespace"
   - Name it (e.g., "celo-health-checks")
   - Note the ID that appears in the dashboard

2. Add the KV namespace ID as a GitHub secret:
   - Go to your GitHub repository > Settings > Secrets and variables > Actions
   - Add a new repository secret named `HEALTH_KV_ID` with the value of your KV namespace ID
   - Add another secret named `HEALTH_KV_PREVIEW_ID` with the same value

3. (Optional) If you want to use separate KV namespaces for each network:
   - Create three KV namespaces in Cloudflare (one for each network)
   - Add the following secrets to GitHub:
     - `MAINNET_HEALTH_KV_ID` and `MAINNET_HEALTH_KV_PREVIEW_ID`
     - `BAKLAVA_HEALTH_KV_ID` and `BAKLAVA_HEALTH_KV_PREVIEW_ID`
     - `ALFAJORES_HEALTH_KV_ID` and `ALFAJORES_HEALTH_KV_PREVIEW_ID`
   - Uncomment the relevant sections in the GitHub Actions workflow file

To set up these secrets:

1. Go to your GitHub repository
2. Click on "Settings" > "Secrets and variables" > "Actions"
3. Click on "New repository secret"
4. Add each of the required secrets

For the GH_PAT:
1. Go to your GitHub account settings
2. Navigate to Developer settings > Personal access tokens > Fine-grained tokens (or Classic tokens)
3. Create a new token with `repo` scope permissions
4. Copy the generated token and add it as a repository secret named `GH_PAT`

### Manual Deployment

You can also deploy the workers manually using the Wrangler CLI:

1. Install Wrangler:
   ```bash
   npm install -g wrangler
   ```

2. Authenticate with Cloudflare:
   ```bash
   wrangler login
   ```

3. Deploy a specific worker:
   ```bash
   cd mainnet
   wrangler publish
   ```

## Adding New RPC Endpoints

To add a new RPC endpoint to a network:

1. Open the network's `rpc-servers.js` file
2. Add the new endpoint URL to the `backendList` array

Example:
```javascript
export const backendList = [
  'https://forno.celo.org',
  'https://your-new-endpoint.example.com',
  // Add additional RPC endpoints here
];
```

The `rpc-servers.js` file can also be updated automatically using the automated process described in the "Automatic RPC Server Updates" section below.

## Response Headers

The RPC proxy includes information about which backend server processed the request in the response headers:

- For single requests: An `X-Backend-Server` header contains the URL of the backend server that processed the request.
- For batch requests: An `X-Backend-Servers` header contains a comma-separated list of all backend servers that processed the requests in the batch.

These headers are useful for debugging, monitoring, and troubleshooting purposes, allowing you to identify which backend server handled a specific request.

Example response headers:
```
Content-Type: application/json
X-Backend-Server: https://forno.celo.org
Access-Control-Allow-Origin: *
```

## Request Failure Handling

The RPC proxy implements different strategies for handling request failures depending on whether it's a single request or a batch request:

### For Single Requests:

- The system implements a retry mechanism with up to 2 retries
- If a request fails, it selects a different backend from the `backendList` using round-robin selection
- It tries the request again with the new backend
- If all retries fail, it returns a JSON-RPC error response

### For Batch Requests:

- Each request in the batch is processed independently
- There is no retry mechanism for individual requests within a batch
- Failed requests return error responses within the batch, while other requests may still succeed

## Health Check System

The RPC proxy includes a comprehensive health check system that automatically detects and excludes unhealthy backends from the rotation. This improves reliability by ensuring that requests are only sent to healthy backends.

### How It Works

The health check system consists of two components:

1. **Passive Health Checks**: Implemented directly in the RPC proxy workers
   - Detect failures during actual user requests
   - Immediately mark failing backends as unhealthy in Cloudflare KV
   - Exclude unhealthy backends from the rotation for a cooldown period (5 minutes)
   - Automatically reinstate backends after the cooldown period

2. **Active Health Checks**: Implemented as a separate scheduled worker
   - Runs every 15 minutes
   - Proactively checks the health of all backends
   - Verifies that backends are fully synced and responsive
   - Marks unhealthy backends in Cloudflare KV

### Health Status Endpoint

The health check system provides a public endpoint that shows the current health status of all backends:

```
https://health.celo-community.org/
```

This endpoint returns a JSON response with information about healthy and unhealthy backends for each network. It's useful for monitoring and debugging purposes.

#### Multi-level Caching Strategy

The health status endpoint implements a sophisticated multi-level caching strategy to optimize performance and reduce resource usage:

- **Cloudflare Edge Caching**: Leverages Cloudflare's global CDN for ultra-fast responses
  - Responses are cached at edge locations worldwide
  - Automatic purging during scheduled health checks
  - Tagged cache entries for targeted invalidation

- **KV Store Caching**: Provides a fallback when edge cache misses occur
  - Complete response caching reduces KV read operations
  - Only updated during scheduled health checks (every 15 minutes)

- **HTTP Cache Headers**: Enable browser and proxy caching
  - ETag and Last-Modified headers for conditional requests
  - 304 Not Modified responses for unchanged content
  - Proper Vary headers for different encodings and origins

- **Client-side Features**:
  - Force refresh option with the refresh button
  - Transparent UI showing all relevant timestamps
  - Cache status indicators in the interface

This approach significantly reduces KV reads while still providing timely health status information.

### Performance Optimizations

The health check system includes several optimizations:

1. **Longer Health Check Interval**: The health check worker runs every 15 minutes
2. **HTTP Response Caching**: Responses are cached for 5 minutes
3. **KV Caching**: Validator addresses are cached for 1 hour
4. **KV Expiration**: Data is stored with appropriate TTLs to clean up stale information
5. **Increased Timeout**: Health check timeout is set to 10 seconds

### Benefits

- **Improved Reliability**: Unhealthy backends are automatically excluded from the rotation
- **Faster Response Times**: Requests are only sent to healthy backends
- **Automatic Recovery**: Backends are automatically reinstated after the cooldown period
- **Proactive Issue Detection**: Active health checks detect issues before they affect users
- **Monitoring**: Public health status endpoint for monitoring and debugging
- **Efficient Resource Usage**: Caching strategy reduces KV operations while maintaining data freshness

### Documentation

For detailed information about the health check system, see [HEALTH-CHECK-README.md](HEALTH-CHECK-README.md).

## Automatic RPC Server Updates

This repository includes an automated system to keep the RPC server lists up-to-date by querying the blockchain for registered community RPC servers and performing health checks.

### How It Works

The `update-rpc-servers.js` script:

1. Queries the blockchain using `celocli network:rpc-urls --node <network>` to get registered RPC servers
2. Performs health checks on all RPC servers (existing and new)
3. Updates the appropriate `rpc-servers.js` files with healthy servers
4. Maintains a history of health checks to avoid removing servers that might be temporarily unavailable

### Automatic Updates via GitHub Actions

A GitHub Actions workflow (`update-rpc-servers.yml`) runs the script daily and creates a pull request with any changes:

1. The workflow runs at midnight UTC every day
2. It can also be triggered manually from the Actions tab
3. It creates a pull request with the updated RPC server lists (requires the `GH_PAT` secret)
4. The pull request can be reviewed and merged by a maintainer

> **Note:** The workflow requires a GitHub Personal Access Token (stored as `GH_PAT` secret) to create pull requests, as the default `GITHUB_TOKEN` may have limited permissions depending on repository settings.

### Running the Update Script Manually

You can also run the update script manually:

1. Install dependencies:
   ```bash
   npm install
   ```

2. Install celocli:
   ```bash
   npm install -g @celo/celocli
   ```

3. Run the script:
   ```bash
   node update-rpc-servers.js
   ```

## DNS Configuration

You need to configure DNS records to point to your Cloudflare Workers:

### RPC Endpoints
- `rpc.celo-community.org` → Mainnet Worker
- `baklava-rpc.celo-community.org` → Baklava Worker
- `alfajores-rpc.celo-community.org` → Alfajores Worker

### Health Check Endpoint
- `health.celo-community.org` → Health Check Worker

This is handled automatically when using Cloudflare as your DNS provider and setting up the routes in the `wrangler.toml` files.


## Website

This repository includes a modern, responsive website that provides information about the Celo Community RPC service. The website is deployed using GitHub Pages and can be accessed at: https://celo-community.org

### Features

- Displays RPC URLs for all three networks (Mainnet, Alfajores, Baklava)
- Shows backend servers for each network
- Provides usage examples for Web3.js, ethers.js, and celo-cli
- Responsive design that works on mobile and desktop
- Dark mode support

### Local Development

To run the website locally:

```bash
# Clone the repository
git clone https://github.com/atweb3-io/celo-community-rpc.git
cd celo-community-rpc

# Open the website in your browser
open public/index.html
```

### Deployment

The website is automatically deployed to GitHub Pages when changes are pushed to the main branch. The deployment is handled by the GitHub Actions workflow defined in `.github/workflows/deploy-github-pages.yml`.
