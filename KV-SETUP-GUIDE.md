# Setting Up Cloudflare KV for Static Content

This guide explains how to set up a Cloudflare KV namespace for static content and add the necessary GitHub Action secrets.

## 1. Create a KV Namespace for Static Content

1. Log in to your Cloudflare dashboard at https://dash.cloudflare.com/
2. Select your account and go to "Workers & Pages"
3. In the navigation menu, click on "KV"
4. Click the "Create namespace" button
5. Enter a name for your namespace (e.g., `celo-health-check-static-content`)
6. Click "Add" to create the namespace

## 2. Get the KV Namespace IDs

After creating the namespace, you'll see it listed in the KV namespaces table. You need to get both the production and preview IDs:

1. Find your newly created namespace in the list
2. Note the ID shown in the table - this is your production ID
3. Click on the namespace name to view its details
4. Look for the "Preview ID" - this is your preview ID

## 3. Add GitHub Action Secrets

1. Go to your GitHub repository
2. Click on "Settings" > "Secrets and variables" > "Actions"
3. Click "New repository secret"
4. Add the following secrets:

   - Name: `STATIC_CONTENT_KV_ID`
     Value: [Your Production KV Namespace ID]
   
   - Name: `STATIC_CONTENT_KV_PREVIEW_ID`
     Value: [Your Preview KV Namespace ID]

## 4. Verify the Setup

1. After adding the secrets, go to the "Actions" tab in your repository
2. Run the "Deploy Cloudflare Workers" workflow manually by clicking on "Run workflow"
3. Once the workflow completes successfully, your health check worker should be able to access the validator addresses from the static content KV namespace

## Notes

- The KV namespace will be automatically populated with the validator-addresses.json files when the GitHub Action runs
- The health check worker will first try to get validator addresses from this KV namespace
- If it can't find them in the KV namespace, it will fall back to fetching from the same origin
- This approach ensures that validator addresses are correctly retrieved even when Cloudflare Workers Sites adds a hash to the filenames