const { execSync } = require('child_process');

// Networks to test
const NETWORKS = ['mainnet', 'baklava', 'alfajores'];

/**
 * Query RPC servers from the blockchain using celocli
 * @param {string} network - The network to query (mainnet, baklava, alfajores)
 */
function queryRpcServersFromBlockchain(network) {
  try {
    console.log(`\n=== Testing celocli for ${network} ===`);
    
    // Execute celocli command to get RPC URLs
    const command = `celocli network:rpc-urls --node ${network}`;
    console.log(`Executing: ${command}`);
    
    const output = execSync(command).toString();
    console.log('\nOutput:');
    console.log(output);
    
    // Parse the output to extract RPC URLs
    // This will depend on the exact format of the celocli output
    const urls = output.split('\n')
      .filter(line => line.trim().startsWith('http'))
      .map(line => line.trim());
    
    console.log(`\nFound ${urls.length} RPC servers for ${network}:`);
    urls.forEach((url, index) => {
      console.log(`${index + 1}. ${url}`);
    });
    
    return urls;
  } catch (error) {
    console.error(`\n❌ Error querying RPC servers for ${network}:`);
    console.error(error.message);
    
    if (error.stdout) {
      console.log('\nStandard output:');
      console.log(error.stdout.toString());
    }
    
    if (error.stderr) {
      console.log('\nError output:');
      console.log(error.stderr.toString());
    }
    
    console.log('\nTroubleshooting tips:');
    console.log('1. Make sure celocli is installed: npm install -g @celo/celocli');
    console.log('2. Check if you can run other celocli commands, e.g.: celocli --version');
    console.log('3. Check your internet connection');
    console.log('4. Try with a specific network node, e.g.: celocli network:rpc-urls --node https://forno.celo.org');
    
    return [];
  }
}

/**
 * Test celocli for all networks
 */
function testCelocli() {
  console.log('Testing celocli command for querying RPC servers...');
  
  try {
    // Check if celocli is installed
    const version = execSync('celocli --version').toString().trim();
    console.log(`celocli version: ${version}`);
  } catch (error) {
    console.error('❌ celocli is not installed or not in PATH');
    console.log('\nPlease install celocli:');
    console.log('npm install -g @celo/celocli');
    process.exit(1);
  }
  
  // Test each network
  for (const network of NETWORKS) {
    queryRpcServersFromBlockchain(network);
  }
  
  console.log('\n=== Test completed ===');
}

// Run the test
testCelocli();