// Baklava testnet configuration
export const backendList = [
  'https://baklava-forno.celo-testnet.org',
  // Add additional baklava testnet RPC endpoints here
];

export async function handleRequest(request) {
  // Handle the RPC request
  const requestBody = await request.json();
  
  // Select a backend using a simple random strategy
  const target = backendList[Math.floor(Math.random() * backendList.length)];
  
  // Forward the request to the selected Celo Baklava testnet RPC endpoint
  const response = await fetch(target, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });
  
  return response;
}