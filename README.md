# Celo Community RPC

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
│       ├── deploy-workers.yml     # Workflow for deploying workers
│       └── update-rpc-servers.yml # Workflow for updating RPC servers
├── mainnet/                       # Mainnet RPC proxy
│   ├── config.js                  # Main request handling logic
│   ├── index.js                   # Worker entry point
│   ├── rpc-servers.js             # RPC endpoint configuration
│   └── wrangler.toml              # Cloudflare Worker configuration
├── baklava/                       # Baklava testnet RPC proxy
│   ├── config.js
│   ├── index.js
│   ├── rpc-servers.js
│   └── wrangler.toml
├── alfajores/                     # Alfajores testnet RPC proxy
│   ├── config.js
│   ├── index.js
│   ├── rpc-servers.js
│   └── wrangler.toml
├── update-rpc-servers.js          # Script to update RPC servers
└── package.json                   # Project dependencies
```

## Configuration

Each network directory contains the following files:

- `index.js`: The entry point for the Cloudflare Worker, which imports and uses the `handleRequest` function from `config.js`.
- `config.js`: Contains the main logic for handling RPC requests, including request validation, forwarding to backends, error handling, and CORS. It imports the `backendList` from `rpc-servers.js`.
- `rpc-servers.js`: Contains the list of backend RPC endpoints. This file can be updated by "celcli call" to fetch registered RPC servers and check their health.
- `wrangler.toml`: Cloudflare Worker configuration file.

The worker randomly selects one of the endpoints from the `backendList` for each request, providing load balancing and failover capabilities. If a request fails, the worker will retry with a different endpoint.

## Deployment

### GitHub Actions

This repository uses GitHub Actions to automatically deploy the workers to Cloudflare. The workflow is defined in `deploy-workers.yml`.

### Required GitHub Secrets

To deploy the workers, you need to set up the following GitHub secrets:

1. `CLOUDFLARE_API_TOKEN`: Your Cloudflare API token with Worker deployment permissions
2. `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare account ID
3. `CLOUDFLARE_ZONE_ID`: The zone ID for your domain

To set up these secrets:

1. Go to your GitHub repository
2. Click on "Settings" > "Secrets and variables" > "Actions"
3. Click on "New repository secret"
4. Add each of the required secrets

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
3. It creates a pull request with the updated RPC server lists
4. The pull request can be reviewed and merged by a maintainer

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

For each network, you need to configure DNS records to point to your Cloudflare Workers:

- `rpc.celo-community.org` → Mainnet Worker
- `baklava-rpc.celo-community.org` → Baklava Worker
- `alfajores-rpc.celo-community.org` → Alfajores Worker

This is handled automatically when using Cloudflare as your DNS provider and setting up the routes in the `wrangler.toml` files.