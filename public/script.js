document.addEventListener('DOMContentLoaded', () => {
    // Network data
    const networks = {
        mainnet: {
            name: 'Mainnet',
            servers: [
                'https://forno.celo.org'
            ]
        },
        alfajores: {
            name: 'Alfajores',
            servers: [
                'https://alfajores-forno.celo-testnet.org'
            ]
        },
        baklava: {
            name: 'Baklava',
            servers: [
                'https://celo-baklava-dev.atweb3.dev',
                'https://baklava-forno.celo-testnet.org'
            ]
        }
    };

    // Server metrics cache
    const serverMetrics = {};

    // Initialize the UI
    initializeUI();

    /**
     * Initialize the UI components
     */
    function initializeUI() {
        // Populate backend server lists
        populateServerLists();
        
        // Set up toggle buttons
        setupToggleButtons();
        
        // Set up copy buttons
        setupCopyButtons();
    }

    /**
     * Populate the backend server lists for each network
     */
    function populateServerLists() {
        for (const [networkId, networkData] of Object.entries(networks)) {
            const serverList = document.getElementById(`${networkId}-server-list`);
            
            if (serverList) {
                // Clear existing items
                serverList.innerHTML = '';
                
                // Add each server to the table
                for (const server of networkData.servers) {
                    // Create a row for the server
                    const row = document.createElement('tr');
                    
                    // Server address cell
                    const addressCell = document.createElement('td');
                    addressCell.className = 'server-address';
                    addressCell.textContent = server;
                    row.appendChild(addressCell);
                    
                    // Latency cell - will be populated when metrics are checked
                    const latencyCell = document.createElement('td');
                    latencyCell.className = 'server-metric';
                    latencyCell.textContent = 'Checking...';
                    row.appendChild(latencyCell);
                    
                    // Status cell - will be populated when metrics are checked
                    const statusCell = document.createElement('td');
                    statusCell.className = 'server-metric';
                    const statusIcon = document.createElement('span');
                    statusIcon.className = 'status-indicator';
                    statusIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="6" x2="12" y2="12"></line><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>';
                    statusCell.appendChild(statusIcon);
                    row.appendChild(statusCell);
                    
                    // Action cell
                    const actionCell = document.createElement('td');
                    const connectBtn = document.createElement('button');
                    connectBtn.className = 'connect-wallet-btn';
                    connectBtn.textContent = 'Connect Wallet';
                    connectBtn.addEventListener('click', () => {
                        // This would typically integrate with a wallet provider
                        alert(`Connecting wallet to ${server}...`);
                    });
                    actionCell.appendChild(connectBtn);
                    row.appendChild(actionCell);
                    
                    // Add the row to the table
                    serverList.appendChild(row);
                    
                    // Store reference to cells that need updating
                    row.dataset.server = server;
                }
            }
        }
    }

    /**
     * Check metrics for all servers in a network
     * @param {string} networkId - The network ID
     */
    async function checkNetworkServers(networkId) {
        const serverList = document.getElementById(`${networkId}-server-list`);
        if (!serverList) return;
        
        const rows = serverList.querySelectorAll('tr');
        
        for (const row of rows) {
            const server = row.dataset.server;
            if (!server) continue;
            
            const latencyCell = row.querySelector('td:nth-child(2)');
            const statusCell = row.querySelector('td:nth-child(3) .status-indicator');
            
            try {
                // Perform real latency check
                const startTime = performance.now();
                const isHealthy = await checkRpcServerHealth(server);
                const endTime = performance.now();
                const latency = ((endTime - startTime) / 1000).toFixed(3);
                
                // Update latency cell
                if (latencyCell) {
                    latencyCell.textContent = `${latency}s`;
                }
                
                // Update status cell
                if (statusCell) {
                    statusCell.className = `status-indicator ${isHealthy ? 'status-good' : 'status-error'}`;
                    statusCell.innerHTML = isHealthy ?
                        getStatusIcon('good') :
                        getStatusIcon('error');
                }
                
            } catch (error) {
                console.error(`Error checking server ${server}:`, error);
                
                // Update cells to show error
                if (latencyCell) {
                    latencyCell.textContent = '-';
                }
                
                if (statusCell) {
                    statusCell.className = 'status-indicator status-error';
                    statusCell.innerHTML = getStatusIcon('error');
                }
            }
        }
    }
    
    /**
     * Check if an RPC server is healthy
     * @param {string} url - The RPC server URL to check
     * @returns {Promise<boolean>} - Whether the server is healthy
     */
    async function checkRpcServerHealth(url) {
        try {
            // Make a JSON-RPC request to check if the server is responsive
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'eth_blockNumber',
                    params: [],
                    id: 1
                }),
                // Set a timeout to avoid waiting too long
                signal: AbortSignal.timeout(5000)
            });
            
            // Check if the response is valid
            if (!response.ok) {
                return false;
            }
            
            const data = await response.json();
            return data && data.result && !data.error;
        } catch (error) {
            console.error(`Health check failed for ${url}:`, error.message);
            return false;
        }
    }

    /**
     * Get the status class based on status value
     * @param {string} status - The status value
     * @returns {string} - CSS class for the status
     */
    function getStatusClass(status) {
        if (!status) return 'status-error';
        
        switch(status) {
            case 'good': return 'status-good';
            case 'warning': return 'status-warning';
            case 'error': return 'status-error';
            default: return '';
        }
    }

    /**
     * Get the status icon HTML based on status value
     * @param {string} status - The status value
     * @returns {string} - HTML for the status icon
     */
    function getStatusIcon(status) {
        if (!status) {
            return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
        }
        
        switch(status) {
            case 'good':
                return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
            case 'warning':
                return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
            case 'error':
                return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
            default:
                return '';
        }
    }

    /**
     * Set up the toggle buttons for showing/hiding backend servers
     */
    function setupToggleButtons() {
        const toggleButtons = document.querySelectorAll('.toggle-btn');
        
        toggleButtons.forEach(button => {
            button.addEventListener('click', () => {
                const networkId = button.getAttribute('data-network');
                const serversElement = document.getElementById(`${networkId}-servers`);
                
                if (serversElement) {
                    // Toggle visibility
                    const isVisible = serversElement.style.display !== 'none';
                    serversElement.style.display = isVisible ? 'none' : 'block';
                    
                    // Update button text and class
                    const buttonText = button.querySelector('span');
                    if (buttonText) {
                        buttonText.textContent = isVisible ? 'Show Backend Servers' : 'Hide Backend Servers';
                    }
                    
                    // Toggle active class for rotation animation
                    button.classList.toggle('active', !isVisible);
                    
                    // If showing the servers, check their metrics
                    if (!isVisible) {
                        // Check server metrics when showing the servers
                        checkNetworkServers(networkId);
                        
                        // Scroll to the backend servers card
                        setTimeout(() => {
                            serversElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        }, 100);
                    }
                }
            });
        });
    }

    /**
     * Set up the copy buttons for copying RPC URLs to clipboard
     */
    function setupCopyButtons() {
        const copyButtons = document.querySelectorAll('.copy-btn');
        const toast = document.getElementById('copy-toast');
        
        copyButtons.forEach(button => {
            button.addEventListener('click', () => {
                const url = button.getAttribute('data-url');
                
                // Copy to clipboard
                navigator.clipboard.writeText(url)
                    .then(() => {
                        // Show toast notification
                        toast.classList.add('show');
                        
                        // Hide toast after 2 seconds
                        setTimeout(() => {
                            toast.classList.remove('show');
                        }, 2000);
                    })
                    .catch(err => {
                        console.error('Failed to copy text: ', err);
                    });
            });
        });
    }
});