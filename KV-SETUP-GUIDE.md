# Setting Up Cloudflare KV Namespaces

This guide explains how to set up the required Cloudflare KV namespaces for the Celo Community RPC project and add the necessary GitHub Action secrets.

## Required KV Namespaces

The project requires two KV namespaces:

1. **HEALTH_KV**: Used to track backend health status across all RPC workers
2. **STATIC_CONTENT_KV**: Used to store static content like validator addresses

## Automated Setup (Recommended)

We've created scripts to automate the setup process for both KV namespaces.

### Prerequisites

1. Install Wrangler CLI globally:
   ```bash
   npm install -g wrangler
   ```

2. Login to Cloudflare:
   ```bash
   wrangler login
   ```

### Setting Up HEALTH_KV Namespace

1. Run the setup script:
   ```bash
   node setup-health-kv.js
   ```

2. The script will:
   - Create the HEALTH_KV namespace if it doesn't exist
   - Output the KV namespace ID and preview ID
   - Save the IDs to `kv-namespace-ids.txt` for reference

3. Add the provided IDs as GitHub Action secrets:
   - Name: `HEALTH_KV_ID`
     Value: [Production KV Namespace ID from script output]
   
   - Name: `HEALTH_KV_PREVIEW_ID`
     Value: [Preview KV Namespace ID from script output]

### Setting Up STATIC_CONTENT_KV Namespace

1. Run the setup script:
   ```bash
   node setup-static-content-kv.js
   ```

2. The script will:
   - Create the STATIC_CONTENT_KV namespace if it doesn't exist
   - Upload validator-addresses.json files to the KV namespace
   - Output the KV namespace ID and preview ID
   - Save the IDs to `static-content-kv-namespace-ids.txt` for reference

3. Add the provided IDs as GitHub Action secrets:
   - Name: `STATIC_CONTENT_KV_ID`
     Value: [Production KV Namespace ID from script output]
   
   - Name: `STATIC_CONTENT_KV_PREVIEW_ID`
     Value: [Preview KV Namespace ID from script output]

## Manual Setup (Alternative)

If you prefer to set up the KV namespaces manually, follow these steps for each namespace:

### 1. Create a KV Namespace

1. Log in to your Cloudflare dashboard at https://dash.cloudflare.com/
2. Select your account and go to "Workers & Pages"
3. In the navigation menu, click on "KV"
4. Click the "Create namespace" button
5. Enter a name for your namespace:
   - For health tracking: `celo-health-check-kv`
   - For static content: `celo-health-check-static-content`
   - Note: Do NOT use `__STATIC_CONTENT` as this is reserved by Cloudflare Workers Sites
6. Click "Add" to create the namespace

### 2. Get the KV Namespace IDs

After creating the namespace, you'll see it listed in the KV namespaces table. You need to get both the production and preview IDs:

1. Find your newly created namespace in the list
2. Note the ID shown in the table - this is your production ID
3. Click on the namespace name to view its details
4. Look for the "Preview ID" - this is your preview ID

### 3. Add GitHub Action Secrets

1. Go to your GitHub repository
2. Click on "Settings" > "Secrets and variables" > "Actions"
3. Click "New repository secret"
4. Add the following secrets for each namespace:

   For HEALTH_KV:
   - Name: `HEALTH_KV_ID`
     Value: [Your Production KV Namespace ID]
   
   - Name: `HEALTH_KV_PREVIEW_ID`
     Value: [Your Preview KV Namespace ID]

   For STATIC_CONTENT_KV:
   - Name: `STATIC_CONTENT_KV_ID`
     Value: [Your Production KV Namespace ID]
   
   - Name: `STATIC_CONTENT_KV_PREVIEW_ID`
     Value: [Your Preview KV Namespace ID]

## 4. Verify the Setup

1. After adding the secrets, go to the "Actions" tab in your repository
2. Run the "Deploy Cloudflare Workers" workflow manually by clicking on "Run workflow"
3. Once the workflow completes successfully, your RPC workers and health check worker should be able to use the KV namespaces

## Notes

- The HEALTH_KV namespace is used by all RPC workers to track backend health status
- The STATIC_CONTENT_KV namespace is used by the health check worker to access validator addresses
- The KV namespaces will be automatically populated with data when the GitHub Action runs
- This approach ensures that health status and validator addresses are correctly tracked and retrieved across all edge locations