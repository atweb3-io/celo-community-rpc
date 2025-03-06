document.addEventListener('DOMContentLoaded', async () => {
    // Network definitions
    const networkIds = ['mainnet', 'alfajores', 'baklava'];
    const networkNames = {
        'mainnet': 'Mainnet',
        'alfajores': 'Alfajores',
        'baklava': 'Baklava'
    };
    
    // Health check endpoint URL
    const HEALTH_CHECK_URL = 'https://health.celo-community.org/';
    
    // Load network data from separate files
    const networks = {};
    
    try {
        // Load RPC server lists for each network
        await Promise.all(networkIds.map(async (networkId) => {
            try {
                // Try to load from the new network-specific file
                const module = await import(`./network/${networkId}/rpc-servers.js`);
                networks[networkId] = {
                    name: networkNames[networkId],
                    servers: module.servers || []
                };
                console.log(`Loaded ${networks[networkId].servers.length} servers for ${networkId} from network-specific file`);
            } catch (error) {
                console.warn(`Failed to load RPC servers for ${networkId} from network-specific file:`, error);
                
                // Fallback to default values if file loading fails
                networks[networkId] = {
                    name: networkNames[networkId],
                    servers: networkId === 'mainnet' ?
                        ['https://forno.celo.org'] :
                        networkId === 'alfajores' ?
                            ['https://alfajores-forno.celo-testnet.org'] :
                            ['https://celo-baklava-dev.atweb3.dev', 'https://baklava-forno.celo-testnet.org']
                };
                console.log(`Using default servers for ${networkId}`);
            }
        }));
    } catch (error) {
        console.error('Error loading network data:', error);
    }

    // Server metrics cache
    const serverMetrics = {};

    // Initialize the UI after loading network data
    initializeUI();
    
    // Fetch health status data
    await fetchHealthStatus();

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
        
        // Set up refresh button for health status
        setupHealthStatusRefresh();
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
     * Set up the refresh button for health status
     */
    function setupHealthStatusRefresh() {
        const refreshButton = document.getElementById('refresh-health-btn');
        if (refreshButton) {
            refreshButton.addEventListener('click', async () => {
                await fetchHealthStatus(true); // Force refresh when button is clicked
            });
        }
    }

    /**
     * Fetch health status data from the health check endpoint
     * @param {boolean} forceRefresh - Whether to force a refresh bypassing the cache
     */
    async function fetchHealthStatus(forceRefresh = false) {
        const healthStatusContent = document.getElementById('health-status-content');
        const lastUpdatedElement = document.getElementById('health-last-updated');
        
        if (!healthStatusContent) return;
        
        // Show loading state
        healthStatusContent.innerHTML = `
            <div class="health-status-loading">
                <div class="spinner"></div>
                <p>Loading health status...</p>
            </div>
        `;
        
        try {
            // Set up fetch options with cache control
            const fetchOptions = {
                cache: forceRefresh ? 'reload' : 'default',
                headers: forceRefresh ? {
                    'Cache-Control': 'no-cache'
                } : {}
            };
            
            // Fetch health status data
            const response = await fetch(HEALTH_CHECK_URL, fetchOptions);
            
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            
            // Get cache status from headers
            const cfCache = response.headers.get('CF-Cache-Status');
            
            const data = await response.json();
            
            // Update last updated time
            if (lastUpdatedElement) {
                const now = new Date();
                
                // Show when the data was generated vs when it was fetched
                if (data.timestamp) {
                    const dataTime = new Date(data.timestamp);
                    lastUpdatedElement.textContent = `Data collected: ${dataTime.toLocaleTimeString()}`;
                    
                    // We no longer show the generated timestamp as it's been removed
                    
                    // Show fetch time
                    lastUpdatedElement.textContent += ` | Fetched: ${now.toLocaleTimeString()}`;
                    
                    // Add tooltip with metadata explanation if available
                    if (data._metadata) {
                        lastUpdatedElement.title = Object.entries(data._metadata)
                            .map(([key, value]) => `${key.replace('_info', '')}: ${value}`)
                            .join('\n');
                    }
                } else {
                    // Fallback if no timestamp in data
                    lastUpdatedElement.textContent = `Fetched: ${now.toLocaleTimeString()}`;
                }
                
                // Show Cloudflare cache status if available
                if (cfCache) {
                    lastUpdatedElement.textContent += ` (CF-Cache: ${cfCache})`;
                }
                
                // If we got a cached response, show that in the UI
                if (response.headers.get('Age')) {
                    const ageSeconds = parseInt(response.headers.get('Age'));
                    lastUpdatedElement.textContent += ` (cached ${ageSeconds}s ago)`;
                }
                
                // If this was a conditional response (304 Not Modified), show that
                if (response.status === 304) {
                    lastUpdatedElement.textContent += ' (304 Not Modified)';
                }
            }
            
            // Display health status data
            displayHealthStatus(data, healthStatusContent);
            
        } catch (error) {
            console.error('Error fetching health status:', error);
            
            // Show error message
            healthStatusContent.innerHTML = `
                <div class="health-status-error">
                    <p>Error loading health status: ${error.message}</p>
                    <button id="retry-health-btn" class="refresh-btn">Retry</button>
                </div>
            `;
            
            // Add event listener to retry button
            const retryButton = document.getElementById('retry-health-btn');
            if (retryButton) {
                retryButton.addEventListener('click', async () => {
                    await fetchHealthStatus(true); // Force refresh on retry
                });
            }
        }
    }
    
    /**
     * Display health status data
     * @param {Object} data - Health status data
     * @param {HTMLElement} container - Container element to display the data
     */
    function displayHealthStatus(data, container) {
        if (!data || !data.networks || !container) return;
        
        // Create HTML content
        let html = '';
        
        // Process each network
        for (const [networkId, networkData] of Object.entries(data.networks)) {
            const healthyServers = networkData.healthy || [];
            const unhealthyServers = networkData.unhealthy || [];
            const totalServers = healthyServers.length + unhealthyServers.length;
            const healthyCount = healthyServers.length;
            
            html += `
                <div class="health-network">
                    <div class="health-network-header">
                        <h4 class="health-network-name">${networkNames[networkId] || networkId}</h4>
                        <span class="health-status-badge ${unhealthyServers.length > 0 ? 'unhealthy' : ''}">
                            ${healthyCount}/${totalServers} Healthy
                        </span>
                    </div>
                    <div class="health-servers">
            `;
            
            // Add healthy servers
            healthyServers.forEach(server => {
                html += createServerCard(server, false);
            });
            
            // Add unhealthy servers
            unhealthyServers.forEach(server => {
                html += createServerCard(server, true);
            });
            
            html += `
                    </div>
                </div>
            `;
        }
        
        // Update container
        container.innerHTML = html;
    }
    
    /**
     * Create a server card HTML
     * @param {Object} server - Server data
     * @param {boolean} isUnhealthy - Whether the server is unhealthy
     * @returns {string} - HTML for the server card
     */
    function createServerCard(server, isUnhealthy) {
        const { url, blockHeight, lastChecked, validatorAddress, reason } = server;
        
        // Format block height
        const formattedBlockHeight = blockHeight ? blockHeight.toLocaleString() : 'N/A';
        
        // Format last checked time
        let formattedLastChecked = 'N/A';
        if (lastChecked) {
            try {
                const date = new Date(lastChecked);
                formattedLastChecked = date.toLocaleString();
            } catch (error) {
                formattedLastChecked = lastChecked;
            }
        }
        
        // Format validator address
        const formattedValidatorAddress = validatorAddress || 'N/A';
        
        return `
            <div class="health-server-card ${isUnhealthy ? 'unhealthy' : ''}">
                <div class="health-server-url">${url}</div>
                <div class="health-server-details">
                    <div class="health-server-detail">
                        <span class="health-detail-label">Block Height</span>
                        <span class="health-detail-value">${formattedBlockHeight}</span>
                    </div>
                    <div class="health-server-detail">
                        <span class="health-detail-label">Last Checked</span>
                        <span class="health-detail-value">${formattedLastChecked}</span>
                    </div>
                    <div class="health-server-detail">
                        <span class="health-detail-label">Validator</span>
                        <span class="health-detail-value" title="${formattedValidatorAddress}">
                            ${formattedValidatorAddress}
                        </span>
                    </div>
                    <div class="health-server-detail">
                        <span class="health-detail-label">Status</span>
                        <span class="health-detail-value ${isUnhealthy ? 'status-error' : 'status-good'}">
                            ${isUnhealthy ? 'Unhealthy' : 'Healthy'}
                        </span>
                    </div>
                </div>
                ${reason ? `<div class="health-server-reason">Reason: ${reason}</div>` : ''}
            </div>
        `;
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