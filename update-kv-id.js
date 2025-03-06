#!/usr/bin/env node

/**
 * Script to update the wrangler.toml files with the correct KV namespace ID
 * 
 * This script will:
 * 1. Get the ID of the celo-health-checks KV namespace
 * 2. Update the wrangler.toml files for all networks
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

// Get the KV namespace ID
console.log(`\nGetting the ID of the ${NAMESPACE_NAME} KV namespace...`);
const listResult = runCommand('wrangler kv:namespace list --json');
if (!listResult.success) {
  console.error('Error listing KV namespaces:', listResult.error);
  process.exit(1);
}

let namespaceId;
let previewNamespaceId;

try {
  const namespaces = JSON.parse(listResult.output);
  const namespace = namespaces.find(ns => ns.title === NAMESPACE_NAME);
  const previewNamespace = namespaces.find(ns => ns.title === PREVIEW_NAMESPACE_NAME);
  
  if (namespace) {
    namespaceId = namespace.id;
    console.log(`Found ${NAMESPACE_NAME} KV namespace with ID: ${namespaceId}`);
  } else {
    console.error(`Error: ${NAMESPACE_NAME} KV namespace not found`);
    console.log('Available namespaces:');
    for (const ns of namespaces) {
      console.log(`- ${ns.title} (ID: ${ns.id})`);
    }
    process.exit(1);
  }
  
  if (previewNamespace) {
    previewNamespaceId = previewNamespace.id;
    console.log(`Found ${PREVIEW_NAMESPACE_NAME} KV namespace with ID: ${previewNamespaceId}`);
  } else {
    console.log(`${PREVIEW_NAMESPACE_NAME} KV namespace not found, creating it...`);
    const createPreviewResult = runCommand(`wrangler kv:namespace create "${PREVIEW_NAMESPACE_NAME}" --json`);
    
    if (createPreviewResult.success) {
      try {
        const createPreviewData = JSON.parse(createPreviewResult.output);
        previewNamespaceId = createPreviewData.id;
        console.log(`Created ${PREVIEW_NAMESPACE_NAME} KV namespace with ID: ${previewNamespaceId}`);
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
  console.error('Error parsing KV namespaces:', error);
  console.error(listResult.output);
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

// Update health-check-worker-wrangler.toml
console.log('\nUpdating health-check-worker-wrangler.toml...');
const healthCheckWranglerPath = 'health-check-worker-wrangler.toml';

if (fs.existsSync(healthCheckWranglerPath)) {
  let wranglerContent = fs.readFileSync(healthCheckWranglerPath, 'utf8');
  
  // Update the IDs
  wranglerContent = wranglerContent.replace(/id = "\$HEALTH_KV_ID"/, `id = "${namespaceId}"`);
  wranglerContent = wranglerContent.replace(/preview_id = "\$HEALTH_KV_PREVIEW_ID"/, `preview_id = "${previewNamespaceId}"`);
  
  // Write the updated content back to the file
  fs.writeFileSync(healthCheckWranglerPath, wranglerContent);
  console.log(`Updated ${healthCheckWranglerPath}`);
} else {
  console.error(`Error: ${healthCheckWranglerPath} not found`);
}

console.log('\n=== KV Namespace ID Update Complete ===');
console.log(`HEALTH_KV_ID: ${namespaceId}`);
console.log(`HEALTH_KV_PREVIEW_ID: ${previewNamespaceId}`);
console.log('\nAll wrangler.toml files have been updated with the correct KV namespace IDs.');
console.log('To deploy the workers, run:');
for (const network of NETWORKS) {
  console.log(`cd ${network} && wrangler deploy && cd ..`);
}
console.log('wrangler deploy -c health-check-worker-wrangler.toml');