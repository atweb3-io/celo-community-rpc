// Mainnet configuration
const RPC_URL = 'https://forno.celo.org';

export async function handleRequest(request) {
  // Handle the RPC request
  const requestBody = await request.json();
  
  // Forward the request to the Celo mainnet RPC endpoint
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });
  
  return response;
}