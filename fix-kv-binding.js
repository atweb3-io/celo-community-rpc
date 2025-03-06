#!/usr/bin/env node

/**
 * Script to fix the KV namespace binding for local testing
 * 
 * This script will:
 * 1. Check if the HEALTH_KV namespace exists
 * 2. Create it if it doesn't exist
 * 3. Update the wrangler.toml files for all networks
 * 4. Deploy the workers with the correct KV binding
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const NAMESPACE_NAME = 'celo-health-checks';
const PREVIEW_NAMESPACE_NAME = 'celo-health-checks-preview';
const NETWORKS = ['mainnet', 'baklava', 'alfajores'];

// Helper function to run commands and capture output
function runCommand(command) {
  try {
    console.log(`Running command: ${command}`);
    const output = execSync(command, { encoding: 'utf8' });
    return { success: true, output };
  } catch (error) {
    return { 
      success: false, 
      error: error.message,
      stdout: error.stdout,
      stderr: error.stderr
    };
  }
}

// Check if wrangler is installed
console.log('Checking if wrangler is installed...');
const wranglerCheck = runCommand('wrangler --version');
if (!wranglerCheck.success) {
  console.error('Error: wrangler is not installed or not in PATH');
  console.error('Please install wrangler globally: npm install -g wrangler');
  console.error('Then login to Cloudflare: wrangler login');
  process.exit(1);
}
console.log(`Wrangler is installed: ${wranglerCheck.output.trim()}`);

// Check if user is logged in
console.log('\nChecking if user is logged in to Cloudflare...');
const whoamiResult = runCommand('wrangler whoami');
if (!whoamiResult.success) {
  console.error('Error: Not logged in to Cloudflare');
  console.error('Please login to Cloudflare: wrangler login');
  process.exit(1);
}
console.log(`Logged in as: ${whoamiResult.output.trim()}`);

// Get or create the HEALTH_KV namespace
console.log(`\nChecking for KV namespace: ${NAMESPACE_NAME}...`);
let namespaceId;
let previewNamespaceId;

// List namespaces to find the ID
const listResult = runCommand('wrangler kv:namespace list --json');
if (listResult.success) {
  try {
    const namespaces = JSON.parse(listResult.output);
    const namespace = namespaces.find(ns => ns.title === NAMESPACE_NAME);
    const previewNamespace = namespaces.find(ns => ns.title === PREVIEW_NAMESPACE_NAME);
    
    if (namespace) {
      namespaceId = namespace.id;
      console.log(`Found existing namespace ID: ${namespaceId}`);
    } else {
      // Create the namespace if it doesn't exist
      console.log(`Creating KV namespace: ${NAMESPACE_NAME}...`);
      const createResult = runCommand(`wrangler kv:namespace create "${NAMESPACE_NAME}" --json`);
      
      if (createResult.success) {
        // Extract the namespace ID from the output
        try {
          const createData = JSON.parse(createResult.output);
          namespaceId = createData.id;
          console.log(`Successfully created KV namespace: ${NAMESPACE_NAME}`);
          console.log(`Namespace ID: ${namespaceId}`);
        } catch (parseError) {
          console.error('Error parsing namespace creation output:', parseError);
          console.error(createResult.output);
          process.exit(1);
        }
      } else {
        console.error('Error creating KV namespace:', createResult.error);
        if (createResult.stdout) console.error('stdout:', createResult.stdout);
        if (createResult.stderr) console.error('stderr:', createResult.stderr);
        process.exit(1);
      }
    }
    
    if (previewNamespace) {
      previewNamespaceId = previewNamespace.id;
      console.log(`Found existing preview namespace ID: ${previewNamespaceId}`);
    } else {
      // Create the preview namespace if it doesn't exist
      console.log(`Creating preview KV namespace: ${PREVIEW_NAMESPACE_NAME}...`);
      const createPreviewResult = runCommand(`wrangler kv:namespace create "${PREVIEW_NAMESPACE_NAME}" --json`);
      
      if (createPreviewResult.success) {
        // Extract the preview namespace ID from the output
        try {
          const createPreviewData = JSON.parse(createPreviewResult.output);
          previewNamespaceId = createPreviewData.id;
          console.log(`Successfully created preview KV namespace: ${PREVIEW_NAMESPACE_NAME}`);
          console.log(`Preview Namespace ID: ${previewNamespaceId}`);
        } catch (parseError) {
          console.error('Error parsing preview namespace creation output:', parseError);
          console.error(createPreviewResult.output);
          process.exit(1);
        }
      } else {
        console.error('Error creating preview KV namespace:', createPreviewResult.error);
        if (createPreviewResult.stdout) console.error('stdout:', createPreviewResult.stdout);
        if (createPreviewResult.stderr) console.error('stderr:', createPreviewResult.stderr);
        process.exit(1);
      }
    }
  } catch (error) {
    console.error('Error parsing namespace list:', error);
    console.error(listResult.output);
    process.exit(1);
  }
} else {
  console.error('Error listing namespaces:', listResult.error);
  process.exit(1);
}

// Save the IDs to a file for reference
const configOutput = `
# Cloudflare KV Namespace IDs
# Created on: ${new Date().toISOString()}

HEALTH_KV_ID=${namespaceId}
HEALTH_KV_PREVIEW_ID=${previewNamespaceId}
`;

fs.writeFileSync('kv-namespace-ids.txt', configOutput);
console.log('\nThese values have also been saved to kv-namespace-ids.txt for reference.');

// Update wrangler.toml files for each network
for (const network of NETWORKS) {
  console.log(`\nUpdating wrangler.toml for ${network}...`);
  const wranglerPath = path.join(network, 'wrangler.toml');
  
  if (fs.existsSync(wranglerPath)) {
    let wranglerContent = fs.readFileSync(wranglerPath, 'utf8');
    
    // Check if KV namespace binding is already present
    if (wranglerContent.includes('[[kv_namespaces]]') && wranglerContent.includes('binding = "HEALTH_KV"')) {
      console.log(`KV namespace binding already exists in ${wranglerPath}`);
      
      // Update the IDs
      wranglerContent = wranglerContent.replace(/id = ".*"/, `id = "${namespaceId}"`);
      wranglerContent = wranglerContent.replace(/preview_id = ".*"/, `preview_id = "${previewNamespaceId}"`);
    } else {
      // Add KV namespace binding
      const kvBinding = `
# KV namespace for tracking backend health status
[[kv_namespaces]]
binding = "HEALTH_KV"
id = "${namespaceId}"
preview_id = "${previewNamespaceId}"
`;
      
      wranglerContent += kvBinding;
    }
    
    // Check if service binding is already present
    if (!wranglerContent.includes('[[services]]') || !wranglerContent.includes('binding = "HEALTH_CHECK_WORKER"')) {
      // Add service binding
      const serviceBinding = `
# Service binding for direct communication with the health check worker
[[services]]
binding = "HEALTH_CHECK_WORKER"
service = "celo-health-check"
environment = "production"
`;
      
      wranglerContent += serviceBinding;
    }
    
    // Write the updated content back to the file
    fs.writeFileSync(wranglerPath, wranglerContent);
    console.log(`Updated ${wranglerPath}`);
  } else {
    console.error(`Error: ${wranglerPath} not found`);
  }
}

console.log('\n=== KV Namespace Setup Complete ===');
console.log(`HEALTH_KV_ID: ${namespaceId}`);
console.log(`HEALTH_KV_PREVIEW_ID: ${previewNamespaceId}`);
console.log('\nAll wrangler.toml files have been updated with the correct KV bindings.');
console.log('To deploy the workers, run:');
for (const network of NETWORKS) {
  console.log(`cd ${network} && wrangler deploy && cd ..`);
}
console.log('wrangler deploy -c health-check-worker-wrangler.toml');