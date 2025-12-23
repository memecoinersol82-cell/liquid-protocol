import { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import {
    OnlinePumpSdk,
    PUMP_SDK,
    getBuyTokenAmountFromSolAmount,
    canonicalPumpPoolPda
} from '@pump-fun/pump-sdk';
import {
    PumpAmmSdk,
    OnlinePumpAmmSdk,
    buyQuoteInput
} from '@pump-fun/pump-swap-sdk';
import BN from 'bn.js';
import bs58 from 'bs58';
import { EventEmitter } from 'events';

export interface BotConfig {
    heliusRpcUrl: string;
    privateKey: string;
    tokenMint: string;
    minFeeThreshold: number; // in SOL
    buybackPercentage: number; // 0-100
    checkInterval: number; // in ms
}

export interface BotStatus {
    isRunning: boolean;
    tokenMint: string;
    currentPhase: 'bonding_curve' | 'pumpswap' | 'unknown';
    totalFeesCollected: number;
    totalBuybacks: number;
    totalSolHeld: number;
    tokensHeld: number;
    lastCheck: Date | null;
    pumpSwapPool: string | null;
}

export interface LogEntry {
    timestamp: Date;
    level: 'info' | 'success' | 'warning' | 'error';
    message: string;
    data?: any;
}

export class LiquidBot extends EventEmitter {
    private connection: Connection;
    private wallet: Keypair;
    private tokenMint: PublicKey;
    private pumpSdk: OnlinePumpSdk;
    private pumpAmmSdk: PumpAmmSdk;
    private onlinePumpAmmSdk: OnlinePumpAmmSdk;
    private config: BotConfig;
    private isRunning: boolean = false;
    private intervalId: NodeJS.Timeout | null = null;
    private status: BotStatus;
    private pumpSwapPool: PublicKey | null = null;

    constructor(config: BotConfig) {
        super();
        this.config = config;
        this.connection = new Connection(config.heliusRpcUrl, 'confirmed');
        this.wallet = Keypair.fromSecretKey(bs58.decode(config.privateKey));
        this.tokenMint = new PublicKey(config.tokenMint);
        this.pumpSdk = new OnlinePumpSdk(this.connection);
        this.pumpAmmSdk = new PumpAmmSdk();
        this.onlinePumpAmmSdk = new OnlinePumpAmmSdk(this.connection);

        this.status = {
            isRunning: false,
            tokenMint: config.tokenMint,
            currentPhase: 'unknown',
            totalFeesCollected: 0,
            totalBuybacks: 0,
            totalSolHeld: 0,
            tokensHeld: 0,
            lastCheck: null,
            pumpSwapPool: null,
        };

        this.log('info', `Bot initialized for token: ${config.tokenMint}`);
        this.log('info', `Wallet: ${this.wallet.publicKey.toBase58()}`);
        this.log('info', `Min fee threshold: ${config.minFeeThreshold} SOL`);
        this.log('info', `Buyback percentage: ${config.buybackPercentage}%`);
    }

    private log(level: LogEntry['level'], message: string, data?: any) {
        const entry: LogEntry = {
            timestamp: new Date(),
            level,
            message,
            data,
        };
        this.emit('log', entry);
    }

    async start() {
        if (this.isRunning) {
            this.log('warning', 'Bot is already running');
            return;
        }

        this.isRunning = true;
        this.status.isRunning = true;
        this.log('success', '🚀 Bot started!');

        // Initial check
        await this.runCycle();

        // Set up interval
        this.intervalId = setInterval(() => this.runCycle(), this.config.checkInterval);
    }

    async stop() {
        if (!this.isRunning) {
            this.log('warning', 'Bot is not running');
            return;
        }

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        this.isRunning = false;
        this.status.isRunning = false;
        this.log('info', '🛑 Bot stopped');
    }

    private async runCycle() {
        try {
            this.log('info', '⏱️ Running cycle...');
            this.status.lastCheck = new Date();

            // Check if token has migrated to PumpSwap
            const phase = await this.checkTokenPhase();
            this.status.currentPhase = phase;
            this.log('info', `Token phase: ${phase}`);

            // Get creator fee balance
            const feeBalance = await this.getCreatorFeeBalance();
            const feeBalanceSOL = feeBalance.toNumber() / 1e9;
            this.log('info', `Creator fee balance: ${feeBalanceSOL.toFixed(6)} SOL`);

            if (feeBalanceSOL >= this.config.minFeeThreshold) {
                this.log('success', `💰 Fees above threshold (${this.config.minFeeThreshold} SOL), claiming...`);

                // Claim fees
                await this.claimFees();
                this.status.totalFeesCollected += feeBalanceSOL;

                // Calculate buyback and hold amounts
                const buybackAmount = (feeBalanceSOL * this.config.buybackPercentage) / 100;
                const holdAmount = feeBalanceSOL - buybackAmount;

                this.log('info', `Buyback amount: ${buybackAmount.toFixed(6)} SOL (${this.config.buybackPercentage}%)`);
                this.log('info', `Hold amount: ${holdAmount.toFixed(6)} SOL (${100 - this.config.buybackPercentage}%)`);

                if (phase === 'bonding_curve') {
                    // Buyback on bonding curve
                    await this.buybackOnBondingCurve(buybackAmount);
                    this.status.totalBuybacks += buybackAmount;
                    this.status.totalSolHeld += holdAmount;
                } else if (phase === 'pumpswap') {
                    // Check if we should add to LP
                    await this.handlePumpSwapPhase(buybackAmount, holdAmount);
                }
            } else {
                this.log('info', `Fees (${feeBalanceSOL.toFixed(6)} SOL) below threshold (${this.config.minFeeThreshold} SOL), skipping...`);
            }

            // Update token balance
            await this.updateTokenBalance();

            this.emit('statusUpdate', this.status);
        } catch (error) {
            this.log('error', `Cycle error: ${error instanceof Error ? error.message : 'Unknown error'}`, error);
        }
    }

    private async checkTokenPhase(): Promise<'bonding_curve' | 'pumpswap' | 'unknown'> {
        try {
            // Try to fetch bonding curve
            const bondingCurve = await this.pumpSdk.fetchBondingCurve(this.tokenMint);

            if (bondingCurve.complete) {
                // Token has migrated to PumpSwap
                await this.detectPumpSwapPool();
                return 'pumpswap';
            }

            return 'bonding_curve';
        } catch (error) {
            this.log('warning', 'Could not determine token phase, checking PumpSwap...');
            await this.detectPumpSwapPool();
            if (this.pumpSwapPool) {
                return 'pumpswap';
            }
            return 'unknown';
        }
    }

    private async detectPumpSwapPool() {
        try {
            const poolAddress = canonicalPumpPoolPda(this.tokenMint);

            // Verify pool exists
            const poolInfo = await this.connection.getAccountInfo(poolAddress);
            if (poolInfo) {
                this.pumpSwapPool = poolAddress;
                this.status.pumpSwapPool = poolAddress.toBase58();
                this.log('success', `🏊 Detected PumpSwap pool: ${poolAddress.toBase58()}`);
            }
        } catch (error) {
            this.log('warning', 'Could not detect PumpSwap pool');
        }
    }

    private async getCreatorFeeBalance(): Promise<BN> {
        try {
            const balance = await this.pumpSdk.getCreatorVaultBalanceBothPrograms(this.wallet.publicKey);
            return balance;
        } catch (error) {
            this.log('error', 'Failed to get creator fee balance');
            return new BN(0);
        }
    }

    private async claimFees() {
        try {
            const instructions = await this.pumpSdk.collectCoinCreatorFeeInstructions(this.wallet.publicKey);

            if (instructions.length === 0) {
                this.log('warning', 'No fee claim instructions generated');
                return;
            }

            const transaction = new Transaction().add(...instructions);
            const signature = await sendAndConfirmTransaction(
                this.connection,
                transaction,
                [this.wallet],
                { commitment: 'confirmed' }
            );

            this.log('success', `✅ Fees claimed! Tx: ${signature}`);
        } catch (error) {
            this.log('error', `Failed to claim fees: ${error instanceof Error ? error.message : 'Unknown error'}`);
            throw error;
        }
    }

    private async buybackOnBondingCurve(solAmount: number) {
        try {
            const solAmountLamports = new BN(Math.floor(solAmount * 1e9));

            const global = await this.pumpSdk.fetchGlobal();
            const feeConfig = await this.pumpSdk.fetchFeeConfig();
            const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } =
                await this.pumpSdk.fetchBuyState(this.tokenMint, this.wallet.publicKey, TOKEN_2022_PROGRAM_ID);

            // Calculate token amount using correct function signature
            const tokenAmount = getBuyTokenAmountFromSolAmount({
                global,
                feeConfig,
                mintSupply: null, // Uses default for non-mayhem mode
                bondingCurve,
                amount: solAmountLamports,
            });

            const instructions = await PUMP_SDK.buyInstructions({
                global,
                bondingCurveAccountInfo,
                bondingCurve,
                associatedUserAccountInfo,
                mint: this.tokenMint,
                user: this.wallet.publicKey,
                amount: tokenAmount,
                solAmount: solAmountLamports,
                slippage: 5, // 5% slippage
                tokenProgram: TOKEN_2022_PROGRAM_ID,
            });

            const transaction = new Transaction().add(...instructions);
            const signature = await sendAndConfirmTransaction(
                this.connection,
                transaction,
                [this.wallet],
                { commitment: 'confirmed' }
            );

            this.log('success', `🔄 Buyback completed! ${solAmount.toFixed(6)} SOL -> tokens. Tx: ${signature}`);
        } catch (error) {
            this.log('error', `Buyback failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            throw error;
        }
    }

    private async handlePumpSwapPhase(buybackAmount: number, holdAmount: number) {
        if (!this.pumpSwapPool) {
            this.log('warning', 'PumpSwap pool not detected, cannot add liquidity');
            // Still do buyback via PumpSwap
            await this.buybackOnPumpSwap(buybackAmount);
            this.status.totalBuybacks += buybackAmount;
            this.status.totalSolHeld += holdAmount;
            return;
        }

        // In PumpSwap phase, we add everything (tokens + SOL) to LP
        const totalSolAvailable = this.status.totalSolHeld + holdAmount;

        this.log('info', `📊 PumpSwap phase detected. Total SOL available for LP: ${totalSolAvailable.toFixed(6)}`);

        // First, do the buyback to accumulate more tokens
        await this.buybackOnPumpSwap(buybackAmount);
        this.status.totalBuybacks += buybackAmount;

        // Then add liquidity with accumulated SOL and tokens
        await this.addLiquidityToPumpSwap(totalSolAvailable);
        this.status.totalSolHeld = 0; // Reset after adding to LP
    }

    private async buybackOnPumpSwap(solAmount: number) {
        try {
            if (!this.pumpSwapPool) {
                this.log('warning', 'No PumpSwap pool to buyback from');
                return;
            }

            const solAmountLamports = new BN(Math.floor(solAmount * 1e9));
            const swapState = await this.onlinePumpAmmSdk.swapSolanaState(this.pumpSwapPool, this.wallet.publicKey);

            this.log('info', `Buying tokens for ${solAmount.toFixed(6)} SOL on PumpSwap`);

            // Execute swap instruction using buyQuoteInput (SOL is the quote token)
            const swapInstructions = await this.pumpAmmSdk.buyQuoteInput(swapState, solAmountLamports, 5);

            const transaction = new Transaction().add(...swapInstructions);
            const signature = await sendAndConfirmTransaction(
                this.connection,
                transaction,
                [this.wallet],
                { commitment: 'confirmed' }
            );

            this.log('success', `🔄 PumpSwap buyback completed! Tx: ${signature}`);
        } catch (error) {
            this.log('error', `PumpSwap buyback failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async addLiquidityToPumpSwap(solAmount: number) {
        try {
            if (!this.pumpSwapPool) {
                this.log('warning', 'No PumpSwap pool to add liquidity to');
                return;
            }

            const liquidityState = await this.onlinePumpAmmSdk.liquiditySolanaState(
                this.pumpSwapPool,
                this.wallet.publicKey
            );

            const solAmountLamports = new BN(Math.floor(solAmount * 1e9));

            // Calculate LP tokens from SOL (quote) input
            const { base: tokenAmount, lpToken } = this.pumpAmmSdk.depositAutocompleteBaseAndLpTokenFromQuote(
                liquidityState,
                solAmountLamports,
                5 // 5% slippage
            );

            this.log('info', `Adding liquidity: ${solAmount.toFixed(6)} SOL + tokens for ${lpToken.toString()} LP tokens`);

            const depositInstructions = await this.pumpAmmSdk.depositInstructions(
                liquidityState,
                lpToken,
                5 // 5% slippage
            );

            const transaction = new Transaction().add(...depositInstructions);
            const signature = await sendAndConfirmTransaction(
                this.connection,
                transaction,
                [this.wallet],
                { commitment: 'confirmed' }
            );

            this.log('success', `💧 Liquidity added to PumpSwap! Tx: ${signature}`);
        } catch (error) {
            this.log('error', `Add liquidity failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async updateTokenBalance() {
        try {
            const ata = getAssociatedTokenAddressSync(
                this.tokenMint,
                this.wallet.publicKey,
                true,
                TOKEN_2022_PROGRAM_ID
            );

            const balance = await this.connection.getTokenAccountBalance(ata);
            this.status.tokensHeld = balance.value.uiAmount || 0;
        } catch (error) {
            // Token account might not exist yet
            this.status.tokensHeld = 0;
        }
    }

    getStatus(): BotStatus {
        return { ...this.status };
    }

    getWalletAddress(): string {
        return this.wallet.publicKey.toBase58();
    }
}
