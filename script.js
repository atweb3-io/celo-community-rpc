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
                
                // Add each server to the list
                networkData.servers.forEach(server => {
                    const listItem = document.createElement('li');
                    listItem.textContent = server;
                    serverList.appendChild(listItem);
                });
            }
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