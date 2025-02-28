// Mainnet configuration
export const backendList = [
  'https://forno.celo.org',
  // Add additional mainnet RPC endpoints here
];

export async function handleRequest(request) {
  // Handle the RPC request
  const requestBody = await request.json();
  
  // Select a backend using a simple random strategy
  const target = backendList[Math.floor(Math.random() * backendList.length)];
  
  // Forward the request to the selected Celo mainnet RPC endpoint
  const response = await fetch(target, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });
  
  return response;
}