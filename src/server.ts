import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import dotenv from 'dotenv';
import { LiquidBot, BotConfig, LogEntry, BotStatus } from './bot';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Store logs in memory (last 500)
const logBuffer: LogEntry[] = [];
const MAX_LOGS = 500;

let bot: LiquidBot | null = null;
let botConfig: BotConfig | null = null;

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// API Routes
app.get('/api/status', (req, res) => {
    if (bot) {
        res.json({
            success: true,
            status: bot.getStatus(),
            config: botConfig ? {
                minFeeThreshold: botConfig.minFeeThreshold,
                buybackPercentage: botConfig.buybackPercentage,
                checkInterval: botConfig.checkInterval,
            } : null
        });
    } else {
        res.json({ success: false, error: 'Bot not initialized - check .env file' });
    }
});

app.get('/api/logs', (req, res) => {
    res.json({ success: true, logs: logBuffer });
});

app.post('/api/start', async (req, res) => {
    if (!bot) {
        return res.json({ success: false, error: 'Bot not initialized - check .env file' });
    }

    try {
        await bot.start();
        res.json({ success: true, message: 'Bot started' });
    } catch (error) {
        res.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
});

app.post('/api/stop', async (req, res) => {
    if (!bot) {
        return res.json({ success: false, error: 'Bot not initialized' });
    }

    try {
        await bot.stop();
        res.json({ success: true, message: 'Bot stopped' });
    } catch (error) {
        res.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
});

// Socket.io connection
io.on('connection', (socket) => {
    console.log('Client connected');

    // Send current logs
    socket.emit('logs', logBuffer);

    // Send current status and config
    if (bot && botConfig) {
        socket.emit('status', bot.getStatus());
        socket.emit('config', {
            minFeeThreshold: botConfig.minFeeThreshold,
            buybackPercentage: botConfig.buybackPercentage,
            checkInterval: botConfig.checkInterval,
        });
        socket.emit('botReady', {
            tokenMint: botConfig.tokenMint,
            wallet: bot.getWalletAddress(),
        });
    } else {
        socket.emit('botError', { error: 'Bot not configured - check .env file' });
    }

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Initialize bot from env
function initBotFromEnv() {
    // Validate required env vars
    if (!process.env.HELIUS_RPC_URL) {
        console.error('❌ HELIUS_RPC_URL is required in .env file');
        return false;
    }
    if (!process.env.PRIVATE_KEY) {
        console.error('❌ PRIVATE_KEY is required in .env file');
        return false;
    }
    if (!process.env.TOKEN_MINT) {
        console.error('❌ TOKEN_MINT is required in .env file');
        return false;
    }

    botConfig = {
        heliusRpcUrl: process.env.HELIUS_RPC_URL,
        privateKey: process.env.PRIVATE_KEY,
        tokenMint: process.env.TOKEN_MINT,
        minFeeThreshold: parseFloat(process.env.MIN_FEE_THRESHOLD || '0.015'),
        buybackPercentage: parseInt(process.env.BUYBACK_PERCENTAGE || '50'),
        checkInterval: parseInt(process.env.CHECK_INTERVAL || '60000'),
    };

    try {
        bot = new LiquidBot(botConfig);

        bot.on('log', (entry: LogEntry) => {
            logBuffer.push(entry);
            if (logBuffer.length > MAX_LOGS) {
                logBuffer.shift();
            }
            io.emit('log', entry);
        });

        bot.on('statusUpdate', (status: BotStatus) => {
            io.emit('status', status);
        });

        console.log(`✅ Bot initialized for token: ${botConfig.tokenMint}`);
        console.log(`   Wallet: ${bot.getWalletAddress()}`);
        console.log(`   Min fee: ${botConfig.minFeeThreshold} SOL`);
        console.log(`   Buyback: ${botConfig.buybackPercentage}%`);
        console.log(`   Interval: ${botConfig.checkInterval}ms`);

        return true;
    } catch (error) {
        console.error('❌ Failed to initialize bot:', error instanceof Error ? error.message : error);
        return false;
    }
}

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   💧 LIQUID LIQUID - Fee Claimer & Buyback Bot 💧         ║
║                                                           ║
║   Server running at: http://localhost:${PORT}               ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);

    const initialized = initBotFromEnv();

    if (!initialized) {
        console.log(`
⚠️  Bot not initialized. Please configure your .env file:

   HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
   PRIVATE_KEY=your_base58_private_key
   TOKEN_MINT=your_token_mint_address
   
   Then restart the server.
    `);
    }
});
