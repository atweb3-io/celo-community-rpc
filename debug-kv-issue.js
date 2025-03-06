// Debug script to test KV namespace access
// This script will be included in the worker to log detailed information about the KV namespace

// Add this to the top of your worker's handleRequest function
export function debugKvNamespace(env) {
  console.log('=== DEBUG KV NAMESPACE ===');
  console.log('env object:', JSON.stringify(env, (key, value) => {
    if (key === 'HEALTH_KV' || key === 'HEALTH_CHECK_WORKER' || key === 'MY_RATE_LIMITER') {
      return `[${key} binding exists]`;
    }
    return value;
  }, 2));
  
  // Check if HEALTH_KV binding exists
  if (env && env.HEALTH_KV) {
    console.log('HEALTH_KV binding exists');
    
    // Test KV operations
    const testKey = `test-key-${Date.now()}`;
    const testValue = `test-value-${Date.now()}`;
    
    // Log all available methods on the KV binding
    console.log('HEALTH_KV methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(env.HEALTH_KV)));
    
    // Test put operation
    try {
      console.log(`Testing KV put operation with key: ${testKey}`);
      // Note: This is async but we're logging synchronously for debugging
      env.HEALTH_KV.put(testKey, testValue)
        .then(() => console.log(`KV put operation succeeded for key: ${testKey}`))
        .catch(error => console.error(`KV put operation failed for key: ${testKey}:`, error));
    } catch (error) {
      console.error('Error testing KV put operation:', error);
    }
    
    // Test get operation
    try {
      console.log(`Testing KV get operation with key: down:test`);
      // Note: This is async but we're logging synchronously for debugging
      env.HEALTH_KV.get('down:test')
        .then(value => console.log(`KV get operation result for key down:test:`, value))
        .catch(error => console.error(`KV get operation failed for key down:test:`, error));
    } catch (error) {
      console.error('Error testing KV get operation:', error);
    }
  } else {
    console.error('HEALTH_KV binding does not exist');
    console.log('Available bindings:', Object.keys(env || {}).join(', '));
  }
  
  // Check if HEALTH_CHECK_WORKER binding exists
  if (env && env.HEALTH_CHECK_WORKER) {
    console.log('HEALTH_CHECK_WORKER binding exists');
    
    // Log all available methods on the service binding
    console.log('HEALTH_CHECK_WORKER methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(env.HEALTH_CHECK_WORKER)));
    
    // Test fetch operation
    try {
      console.log('Testing service binding fetch operation');
      // Note: This is async but we're logging synchronously for debugging
      env.HEALTH_CHECK_WORKER.fetch(new Request('https://health.celo-community.org/refresh'))
        .then(response => console.log(`Service binding fetch operation result:`, response.status))
        .catch(error => console.error(`Service binding fetch operation failed:`, error));
    } catch (error) {
      console.error('Error testing service binding fetch operation:', error);
    }
  } else {
    console.error('HEALTH_CHECK_WORKER binding does not exist');
  }
  
  console.log('=== END DEBUG KV NAMESPACE ===');
}