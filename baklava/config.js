// Baklava testnet configuration
const RPC_URL = 'https://baklava-forno.celo-testnet.org';

export async function handleRequest(request) {
  // Handle the RPC request
  const requestBody = await request.json();
  
  // Forward the request to the Celo Baklava testnet RPC endpoint
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });
  
  return response;
}