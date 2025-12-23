// Socket.io connection
const socket = io();

// DOM Elements
const connectionStatus = document.getElementById('connectionStatus');
const terminal = document.getElementById('terminal');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const clearLogsBtn = document.getElementById('clearLogs');
const scrollBottomBtn = document.getElementById('scrollBottom');

// Status elements
const botStatus = document.getElementById('botStatus');
const phaseBadge = document.getElementById('phaseBadge');
const feesCollected = document.getElementById('feesCollected');
const buybacks = document.getElementById('buybacks');
const solHeld = document.getElementById('solHeld');
const tokensHeld = document.getElementById('tokensHeld');
const tokenMint = document.getElementById('tokenMint');
const walletAddress = document.getElementById('walletAddress');
const poolAddress = document.getElementById('poolAddress');
const lastCheck = document.getElementById('lastCheck');

// Config elements
const configMinFee = document.getElementById('configMinFee');
const configBuyback = document.getElementById('configBuyback');
const configInterval = document.getElementById('configInterval');

// Auto-scroll state
let autoScroll = true;

// Socket events
socket.on('connect', () => {
    connectionStatus.classList.add('connected');
    connectionStatus.classList.remove('error');
    connectionStatus.querySelector('.status-text').textContent = 'Connected';
    addLog({ level: 'success', message: '🔌 Connected to server', timestamp: new Date() });
});

socket.on('disconnect', () => {
    connectionStatus.classList.remove('connected');
    connectionStatus.classList.add('error');
    connectionStatus.querySelector('.status-text').textContent = 'Disconnected';
    addLog({ level: 'error', message: '❌ Disconnected from server', timestamp: new Date() });
});

socket.on('logs', (logs) => {
    logs.forEach(log => addLog(log, false));
    scrollToBottom();
});

socket.on('log', (entry) => {
    addLog(entry);
});

socket.on('status', (status) => {
    updateStatus(status);
});

socket.on('config', (config) => {
    updateConfig(config);
});

socket.on('botReady', (data) => {
    tokenMint.textContent = truncateAddress(data.tokenMint);
    tokenMint.title = data.tokenMint;
    walletAddress.textContent = truncateAddress(data.wallet);
    walletAddress.title = data.wallet;
    botStatus.textContent = '✅ Ready';
    botStatus.className = 'bot-status-value ready';
    startBtn.disabled = false;
});

socket.on('botError', (data) => {
    botStatus.textContent = '❌ ' + data.error;
    botStatus.className = 'bot-status-value error';
    startBtn.disabled = true;
});

// Functions
function addLog(entry, scroll = true) {
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';

    const timestamp = new Date(entry.timestamp).toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    logEntry.innerHTML = `
    <span class="log-timestamp">[${timestamp}]</span>
    <span class="log-level ${entry.level}">${entry.level}</span>
    <span class="log-message ${entry.level}">${escapeHtml(entry.message)}</span>
  `;

    terminal.appendChild(logEntry);

    if (scroll && autoScroll) {
        scrollToBottom();
    }

    // Limit logs in DOM
    while (terminal.children.length > 501) {
        terminal.removeChild(terminal.children[1]);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function scrollToBottom() {
    terminal.scrollTop = terminal.scrollHeight;
}

function updateStatus(status) {
    // Phase badge
    phaseBadge.textContent = status.currentPhase.replace('_', ' ');
    phaseBadge.className = `phase-badge ${status.currentPhase}`;

    // Bot status
    if (status.isRunning) {
        botStatus.textContent = '🟢 Running';
        botStatus.className = 'bot-status-value running';
    } else {
        botStatus.textContent = '⏸️ Stopped';
        botStatus.className = 'bot-status-value stopped';
    }

    // Stats
    feesCollected.textContent = status.totalFeesCollected.toFixed(4);
    buybacks.textContent = status.totalBuybacks.toFixed(4);
    solHeld.textContent = status.totalSolHeld.toFixed(4);
    tokensHeld.textContent = formatNumber(status.tokensHeld);

    // Token
    if (status.tokenMint) {
        tokenMint.textContent = truncateAddress(status.tokenMint);
        tokenMint.title = status.tokenMint;
    }

    // Pool
    if (status.pumpSwapPool) {
        poolAddress.textContent = truncateAddress(status.pumpSwapPool);
        poolAddress.title = status.pumpSwapPool;
    } else {
        poolAddress.textContent = 'Not detected';
    }

    // Last check
    if (status.lastCheck) {
        lastCheck.textContent = new Date(status.lastCheck).toLocaleTimeString();
    }

    // Buttons
    startBtn.disabled = status.isRunning;
    stopBtn.disabled = !status.isRunning;
}

function updateConfig(config) {
    configMinFee.textContent = config.minFeeThreshold + ' SOL';
    configBuyback.textContent = config.buybackPercentage + '%';
    configInterval.textContent = (config.checkInterval / 1000) + 's';
}

function truncateAddress(address) {
    if (!address || address.length < 10) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatNumber(num) {
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toFixed(2);
}

// Event Listeners
startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;

    try {
        const response = await fetch('/api/start', { method: 'POST' });
        const result = await response.json();

        if (result.success) {
            stopBtn.disabled = false;
        } else {
            addLog({ level: 'error', message: `❌ Start failed: ${result.error}`, timestamp: new Date() });
            startBtn.disabled = false;
        }
    } catch (error) {
        addLog({ level: 'error', message: `❌ Start error: ${error.message}`, timestamp: new Date() });
        startBtn.disabled = false;
    }
});

stopBtn.addEventListener('click', async () => {
    stopBtn.disabled = true;

    try {
        const response = await fetch('/api/stop', { method: 'POST' });
        const result = await response.json();

        if (result.success) {
            startBtn.disabled = false;
        } else {
            addLog({ level: 'error', message: `❌ Stop failed: ${result.error}`, timestamp: new Date() });
            stopBtn.disabled = false;
        }
    } catch (error) {
        addLog({ level: 'error', message: `❌ Stop error: ${error.message}`, timestamp: new Date() });
        stopBtn.disabled = false;
    }
});

clearLogsBtn.addEventListener('click', () => {
    const welcomeMessage = terminal.querySelector('.terminal-welcome');
    terminal.innerHTML = '';
    if (welcomeMessage) {
        terminal.appendChild(welcomeMessage);
    }
    addLog({ level: 'info', message: '🗑️ Logs cleared', timestamp: new Date() });
});

scrollBottomBtn.addEventListener('click', () => {
    scrollToBottom();
    autoScroll = true;
});

terminal.addEventListener('scroll', () => {
    const isAtBottom = terminal.scrollHeight - terminal.scrollTop <= terminal.clientHeight + 50;
    autoScroll = isAtBottom;
});

// Initial status fetch
async function fetchInitialStatus() {
    try {
        const response = await fetch('/api/status');
        const result = await response.json();
        if (result.success) {
            updateStatus(result.status);
            if (result.config) {
                updateConfig(result.config);
            }
        }
    } catch (error) {
        console.error('Failed to fetch initial status:', error);
    }
}

fetchInitialStatus();

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        clearLogsBtn.click();
    }
    if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        scrollBottomBtn.click();
    }
});
