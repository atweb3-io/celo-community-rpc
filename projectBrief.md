Celo Community RPC Node Gateway is a service which gives access to multiple celo blockchain rpc nodes with a unified gateway which acts as a reverse proxy. The project currently contains 3 celo networks: mainnet, baklva, alfajores. It uses Cloudflare Workers which create reverse proxy for each network. Everything is deployed with github actions which also continously check and update the rpc server list.  The workers distribute requests across multiple backend RPC nodes to improve reliability and performance. The repository is organized by network, with each network having its own directory.

Each network directory contains the following files:

- `index.js`: The entry point for the Cloudflare Worker, which imports and uses the `handleRequest` function from `config.js`.
- `config.js`: Contains the main logic for handling RPC requests, including request validation, forwarding to backends, error handling, and CORS. It imports the `backendList` from `rpc-servers.js`.
- `rpc-servers.js`: Contains the list of backend RPC endpoints. This file can be updated by "celcli call" to fetch registered RPC servers and check their health.
- `wrangler.toml`: Cloudflare Worker configuration file.

The worker uses a round-robin strategy to select endpoints from the `backendList` for each request, providing load balancing and failover capabilities. If a request fails, the worker will retry with a different endpoint.

This repository uses GitHub Actions to automatically deploy the workers to Cloudflare. The workflow is defined in `deploy-workers.yml`.