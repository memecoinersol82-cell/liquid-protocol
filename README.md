# 💧 Liquid Protocol

Automated fee management bot for pump.fun Token-2022 tokens.

## What it does

**Before graduation (Bonding Curve):**
- Claims creator fees automatically when they hit threshold (0.015 SOL)
- 50% instant buybacks (creates buying pressure)
- 50% held as SOL until graduation

**On graduation:**
- Detects migration to PumpSwap automatically
- ALL accumulated SOL + tokens → dumped into LP

**After graduation (PumpSwap):**
- Bot keeps running forever
- 50% buys tokens (buying pressure)
- 50% stays as SOL
- Both paired → added as LP
- Liquidity grows forever

## Features

- 🔄 **Auto Fee Claiming** - Claims Token-2022 creator fees automatically
- 💰 **50/50 Strategy** - Balanced buyback and treasury building
- 🎓 **Migration Detection** - Knows when you graduate to PumpSwap
- 💧 **LP Addition** - Adds liquidity on graduation and continuously after
- 🖥️ **Live Dashboard** - Real-time terminal logs via Socket.io
- ⚡ **Helius RPC** - Fast and reliable infrastructure

## Setup

1. Clone the repo:
```bash
git clone https://github.com/YOUR_USERNAME/liquid-protocol.git
cd liquid-protocol
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment:
```bash
cp .env.example .env
```

Edit `.env` with your settings:
```env
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
PRIVATE_KEY=your_base58_private_key
TOKEN_MINT=your_token_mint_address
MIN_FEE_THRESHOLD=0.015
BUYBACK_PERCENTAGE=50
CHECK_INTERVAL=60000
```

4. Run the bot:
```bash
npm run dev
```

5. Open http://localhost:3000 to see the dashboard

## Scripts

- `npm run dev` - Run in development mode
- `npm run build` - Build for production
- `npm start` - Run production build

## Tech Stack

- TypeScript
- @pump-fun/pump-sdk
- @pump-fun/pump-swap-sdk
- Express + Socket.io
- Helius RPC

## License

MIT

---

💧 Win. And help others win.
