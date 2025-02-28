# Celo Community RPC

This repository contains Cloudflare Workers that serve as reverse proxies for Celo blockchain RPC endpoints. The workers distribute requests across multiple backend RPC nodes to improve reliability and performance.

## Repository Structure

The repository is organized by network, with each network having its own directory:

```
celo-community-rpc/
├── mainnet/           # Mainnet RPC proxy
│   ├── config.js      # RPC endpoint configuration
│   ├── index.js       # Worker entry point
│   └── wrangler.toml  # Cloudflare Worker configuration
├── baklava/           # Baklava testnet RPC proxy
│   ├── config.js
│   ├── index.js
│   └── wrangler.toml
└── alfajores/         # Alfajores testnet RPC proxy
    ├── config.js
    ├── index.js
    └── wrangler.toml
```

## Configuration

Each network's `config.js` file contains a list of backend RPC endpoints. The worker randomly selects one of these endpoints for each request, providing load balancing and failover capabilities.

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

1. Open the network's `config.js` file
2. Add the new endpoint URL to the `backendList` array

Example:
```javascript
export const backendList = [
  'https://forno.celo.org',
  'https://your-new-endpoint.example.com',
];
```

## DNS Configuration

For each network, you need to configure DNS records to point to your Cloudflare Workers:

- `rpc.celo-community.org` → Mainnet Worker
- `rpc.baklava.celo-community.org` → Baklava Worker
- `rpc.alfajores.celo-community.org` → Alfajores Worker

This is handled automatically when using Cloudflare as your DNS provider and setting up the routes in the `wrangler.toml` files.

## License

[Add your license information here]