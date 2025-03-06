#!/usr/bin/env node

/**
 * Script to create and set up the STATIC_CONTENT_KV namespace in Cloudflare
 * 
 * Usage:
 * 1. Install wrangler globally: npm install -g wrangler
 * 2. Login to Cloudflare: wrangler login
 * 3. Run this script: node setup-static-content-kv.js
 * 
 * This script will:
 * 1. Create the STATIC_CONTENT_KV namespace if it doesn't exist
 * 2. Upload validator-addresses.json files to the KV namespace
 * 3. Output the KV namespace ID and preview ID
 * 4. Provide instructions for adding these as GitHub Action secrets
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const NAMESPACE_NAME = 'celo-health-check-static-content';
const PREVIEW_NAMESPACE_NAME = 'celo-health-check-static-content-preview';
const NETWORKS = ['mainnet', 'baklava', 'alfajores'];

// Helper function to run commands and capture output
function runCommand(command) {
  try {
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

// Create the STATIC_CONTENT_KV namespace
console.log(`\nCreating KV namespace: ${NAMESPACE_NAME}...`);
const createResult = runCommand(`wrangler kv:namespace create "${NAMESPACE_NAME}"`);

let namespaceId;
let previewNamespaceId;

if (createResult.success) {
  // Extract the namespace ID from the output
  const match = createResult.output.match(/id = "([^"]+)"/);
  if (match && match[1]) {
    namespaceId = match[1];
    console.log(`Successfully created KV namespace: ${NAMESPACE_NAME}`);
    console.log(`Namespace ID: ${namespaceId}`);
  } else {
    console.error('Error: Failed to extract namespace ID from output');
    console.error(createResult.output);
    process.exit(1);
  }
} else if (createResult.stdout && createResult.stdout.includes('already exists')) {
  console.log(`KV namespace ${NAMESPACE_NAME} already exists, retrieving ID...`);
  
  // List namespaces to find the ID
  const listResult = runCommand('wrangler kv:namespace list');
  if (listResult.success) {
    try {
      const namespaces = JSON.parse(listResult.output);
      const namespace = namespaces.find(ns => ns.title === NAMESPACE_NAME);
      if (namespace) {
        namespaceId = namespace.id;
        console.log(`Found existing namespace ID: ${namespaceId}`);
      } else {
        console.error(`Error: Could not find namespace with name ${NAMESPACE_NAME}`);
        process.exit(1);
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
} else {
  console.error('Error creating KV namespace:', createResult.error);
  if (createResult.stdout) console.error('stdout:', createResult.stdout);
  if (createResult.stderr) console.error('stderr:', createResult.stderr);
  process.exit(1);
}

// Create the preview namespace
console.log(`\nCreating preview KV namespace: ${PREVIEW_NAMESPACE_NAME}...`);
const createPreviewResult = runCommand(`wrangler kv:namespace create "${PREVIEW_NAMESPACE_NAME}"`);

if (createPreviewResult.success) {
  // Extract the preview namespace ID from the output
  const match = createPreviewResult.output.match(/id = "([^"]+)"/);
  if (match && match[1]) {
    previewNamespaceId = match[1];
    console.log(`Successfully created preview KV namespace: ${PREVIEW_NAMESPACE_NAME}`);
    console.log(`Preview Namespace ID: ${previewNamespaceId}`);
  } else {
    console.error('Error: Failed to extract preview namespace ID from output');
    console.error(createPreviewResult.output);
    process.exit(1);
  }
} else if (createPreviewResult.stdout && createPreviewResult.stdout.includes('already exists')) {
  console.log(`Preview KV namespace ${PREVIEW_NAMESPACE_NAME} already exists, retrieving ID...`);
  
  // List namespaces to find the ID
  const listResult = runCommand('wrangler kv:namespace list');
  if (listResult.success) {
    try {
      const namespaces = JSON.parse(listResult.output);
      const namespace = namespaces.find(ns => ns.title === PREVIEW_NAMESPACE_NAME);
      if (namespace) {
        previewNamespaceId = namespace.id;
        console.log(`Found existing preview namespace ID: ${previewNamespaceId}`);
      } else {
        console.error(`Error: Could not find preview namespace with name ${PREVIEW_NAMESPACE_NAME}`);
        process.exit(1);
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
} else {
  console.error('Error creating preview KV namespace:', createPreviewResult.error);
  if (createPreviewResult.stdout) console.error('stdout:', createPreviewResult.stdout);
  if (createPreviewResult.stderr) console.error('stderr:', createPreviewResult.stderr);
  process.exit(1);
}

// Upload validator-addresses.json files to the KV namespace
console.log('\nUploading validator-addresses.json files to the KV namespace...');

for (const network of NETWORKS) {
  const validatorAddressesPath = path.join(network, 'validator-addresses.json');
  
  if (fs.existsSync(validatorAddressesPath)) {
    console.log(`Uploading ${validatorAddressesPath} to KV namespace...`);
    
    try {
      const fileContent = fs.readFileSync(validatorAddressesPath, 'utf8');
      
      // Upload to production namespace
      const uploadResult = runCommand(`wrangler kv:key put --namespace-id=${namespaceId} "${network}/validator-addresses.json" '${fileContent.replace(/'/g, "'\\''")}'`);
      
      if (uploadResult.success) {
        console.log(`Successfully uploaded ${validatorAddressesPath} to production namespace`);
      } else {
        console.error(`Error uploading ${validatorAddressesPath} to production namespace:`, uploadResult.error);
        if (uploadResult.stdout) console.error('stdout:', uploadResult.stdout);
        if (uploadResult.stderr) console.error('stderr:', uploadResult.stderr);
      }
      
      // Upload to preview namespace
      const uploadPreviewResult = runCommand(`wrangler kv:key put --namespace-id=${previewNamespaceId} "${network}/validator-addresses.json" '${fileContent.replace(/'/g, "'\\''")}'`);
      
      if (uploadPreviewResult.success) {
        console.log(`Successfully uploaded ${validatorAddressesPath} to preview namespace`);
      } else {
        console.error(`Error uploading ${validatorAddressesPath} to preview namespace:`, uploadPreviewResult.error);
        if (uploadPreviewResult.stdout) console.error('stdout:', uploadPreviewResult.stdout);
        if (uploadPreviewResult.stderr) console.error('stderr:', uploadPreviewResult.stderr);
      }
    } catch (error) {
      console.error(`Error reading ${validatorAddressesPath}:`, error.message);
    }
  } else {
    console.warn(`Warning: ${validatorAddressesPath} not found, skipping upload`);
  }
}

// Output the results and next steps
console.log('\n=== Static Content KV Namespace Setup Complete ===');
console.log(`STATIC_CONTENT_KV_ID: ${namespaceId}`);
console.log(`STATIC_CONTENT_KV_PREVIEW_ID: ${previewNamespaceId}`);
console.log('\nNext steps:');
console.log('1. Add these values as GitHub Action secrets:');
console.log('   - Name: STATIC_CONTENT_KV_ID');
console.log(`   - Value: ${namespaceId}`);
console.log('   - Name: STATIC_CONTENT_KV_PREVIEW_ID');
console.log(`   - Value: ${previewNamespaceId}`);
console.log('2. Run the GitHub Action to deploy the workers with the KV namespace bindings');
console.log('\nYou can also add these values to your local health-check-worker-wrangler.toml file for testing:');
console.log('```toml');
console.log('[[kv_namespaces]]');
console.log('binding = "STATIC_CONTENT_KV"');
console.log(`id = "${namespaceId}"`);
console.log(`preview_id = "${previewNamespaceId}"`);
console.log('```');

// Save the IDs to a file for reference
const configOutput = `
# Cloudflare KV Namespace IDs for Static Content
# Created on: ${new Date().toISOString()}

STATIC_CONTENT_KV_ID=${namespaceId}
STATIC_CONTENT_KV_PREVIEW_ID=${previewNamespaceId}
`;

fs.writeFileSync('static-content-kv-namespace-ids.txt', configOutput);
console.log('\nThese values have also been saved to static-content-kv-namespace-ids.txt for reference.');