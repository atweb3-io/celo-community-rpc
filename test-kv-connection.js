#!/usr/bin/env node

/**
 * Script to test the KV namespace connection
 * 
 * This script will:
 * 1. Check if the HEALTH_KV namespace exists
 * 2. Try to read and write to the KV namespace
 * 3. Report the results
 */

const { execSync } = require('child_process');

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

// List KV namespaces
console.log('\nListing KV namespaces...');
const listResult = runCommand('wrangler kv:namespace list --json');
if (!listResult.success) {
  console.error('Error listing KV namespaces:', listResult.error);
  process.exit(1);
}

try {
  const namespaces = JSON.parse(listResult.output);
  console.log(`Found ${namespaces.length} KV namespaces:`);
  
  for (const namespace of namespaces) {
    console.log(`- ${namespace.title} (ID: ${namespace.id})`);
  }
  
  // Look for the health check KV namespace
  const healthNamespace = namespaces.find(ns => ns.title === 'celo-health-checks');
  if (healthNamespace) {
    console.log(`\nFound health check KV namespace: ${healthNamespace.title} (ID: ${healthNamespace.id})`);
    
    // Try to read from the KV namespace
    console.log('\nTrying to read from the KV namespace...');
    const readResult = runCommand(`wrangler kv:key get --namespace-id=${healthNamespace.id} "test-key"`);
    
    if (readResult.success) {
      console.log(`Successfully read from KV namespace: ${readResult.output.trim()}`);
    } else {
      console.log('Key not found, which is expected if it hasn\'t been created yet');
    }
    
    // Try to write to the KV namespace
    console.log('\nTrying to write to the KV namespace...');
    const writeResult = runCommand(`wrangler kv:key put --namespace-id=${healthNamespace.id} "test-key" "test-value-${Date.now()}"`);
    
    if (writeResult.success) {
      console.log('Successfully wrote to KV namespace');
      
      // Try to read the key again
      console.log('\nTrying to read the key again...');
      const readAgainResult = runCommand(`wrangler kv:key get --namespace-id=${healthNamespace.id} "test-key"`);
      
      if (readAgainResult.success) {
        console.log(`Successfully read from KV namespace: ${readAgainResult.output.trim()}`);
      } else {
        console.error('Error reading from KV namespace:', readAgainResult.error);
      }
    } else {
      console.error('Error writing to KV namespace:', writeResult.error);
    }
    
    // Try to list keys in the KV namespace
    console.log('\nTrying to list keys in the KV namespace...');
    const listKeysResult = runCommand(`wrangler kv:key list --namespace-id=${healthNamespace.id} --prefix="down:"`);
    
    if (listKeysResult.success) {
      console.log('Successfully listed keys in KV namespace:');
      console.log(listKeysResult.output);
    } else {
      console.error('Error listing keys in KV namespace:', listKeysResult.error);
    }
  } else {
    console.error('\nError: Health check KV namespace not found');
    console.log('Available namespaces:');
    for (const namespace of namespaces) {
      console.log(`- ${namespace.title} (ID: ${namespace.id})`);
    }
  }
} catch (error) {
  console.error('Error parsing KV namespaces:', error);
  console.error(listResult.output);
}