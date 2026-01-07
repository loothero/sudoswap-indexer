/**
 * sudoAMM v2 Indexer
 *
 * Indexes all sudoAMM v2 Cairo contract events and persists them to PostgreSQL.
 * Uses the Apibara SDK with Drizzle ORM for storage.
 *
 * Event Sources:
 * - Factory contract (LSSVMPairFactory): Pool creation, protocol settings
 * - Pair contracts (LSSVMPairERC721/ERC1155): Swaps, parameter updates
 *
 * Architecture:
 * - Factory events filtered by factory address
 * - Pair events tracked dynamically as pools are created
 * - All events processed in transform function
 */

import { defineIndexer } from "apibara/indexer";
import { useLogger } from "apibara/plugins";
import { StarknetStream } from "@apibara/starknet";
import {
  drizzle,
  drizzleStorage,
  useDrizzleStorage,
} from "@apibara/plugin-drizzle";
import { eq, and, inArray } from "drizzle-orm";
import type { ApibaraRuntimeConfig } from "apibara/types";

import * as schema from "../src/lib/schema.js";
import {
  EVENT_SELECTORS,
  feltToHex,
  // Factory event decoders
  decodeNewERC721Pair,
  decodeNewERC1155Pair,
  decodeERC20Deposit,
  decodeNFTDeposit,
  decodeERC1155Deposit,
  decodeProtocolFeeRecipientUpdate,
  decodeProtocolFeeMultiplierUpdate,
  decodeBondingCurveStatusUpdate,
  decodeRouterStatusUpdate,
  // Pair event decoders
  decodeSpotPriceUpdate,
  decodeDeltaUpdate,
  decodeFeeUpdate,
  decodeAssetRecipientChange,
  decodeTokenDeposit,
  decodeTokenWithdrawal,
  decodeOwnershipTransferred,
  // ERC721 swap event decoders
  decodeSwapNFTOutPairIds,
  decodeSwapNFTInPairIds,
  decodeNFTWithdrawalIds,
  // ERC1155 swap event decoders
  decodeSwapNFTOutPairCount,
  decodeSwapNFTInPairCount,
  decodeNFTWithdrawalCount,
} from "../src/lib/decoder.js";

interface SudoswapConfig {
  factoryAddress: string;
  streamUrl: string;
  startingBlock: string;
  databaseUrl: string;
}

// In-memory set of known pair addresses for filtering
// This is populated from the database on startup and updated as new pairs are created
const knownPairAddresses = new Set<string>();

export default function indexer(runtimeConfig: ApibaraRuntimeConfig) {
  const config = runtimeConfig.sudoswap as SudoswapConfig;
  const {
    factoryAddress,
    streamUrl,
    startingBlock: startBlockStr,
    databaseUrl,
  } = config;
  const startingBlock = BigInt(startBlockStr);

  // Normalize factory address
  const normalizedFactoryAddress = factoryAddress.toLowerCase().startsWith("0x")
    ? factoryAddress.toLowerCase()
    : `0x${factoryAddress.toLowerCase()}`;

  console.log("[Indexer] Factory:", factoryAddress);
  console.log("[Indexer] Stream:", streamUrl);
  console.log("[Indexer] Starting Block:", startingBlock.toString());

  // Create Drizzle database instance
  const database = drizzle({ schema, connectionString: databaseUrl });

  return defineIndexer(StarknetStream)({
    streamUrl,
    finality: "pending",
    startingBlock,
    // Filter by event selectors (no address = matches all contracts)
    // We verify the emitting address in the transform function
    filter: {
      events: [
        // Factory events
        { keys: [EVENT_SELECTORS.NewERC721Pair as `0x${string}`] },
        { keys: [EVENT_SELECTORS.NewERC1155Pair as `0x${string}`] },
        { keys: [EVENT_SELECTORS.ERC20Deposit as `0x${string}`] },
        { keys: [EVENT_SELECTORS.NFTDeposit as `0x${string}`] },
        { keys: [EVENT_SELECTORS.ERC1155Deposit as `0x${string}`] },
        { keys: [EVENT_SELECTORS.ProtocolFeeRecipientUpdate as `0x${string}`] },
        { keys: [EVENT_SELECTORS.ProtocolFeeMultiplierUpdate as `0x${string}`] },
        { keys: [EVENT_SELECTORS.BondingCurveStatusUpdate as `0x${string}`] },
        { keys: [EVENT_SELECTORS.RouterStatusUpdate as `0x${string}`] },
        // Pair parameter events
        { keys: [EVENT_SELECTORS.SpotPriceUpdate as `0x${string}`] },
        { keys: [EVENT_SELECTORS.DeltaUpdate as `0x${string}`] },
        { keys: [EVENT_SELECTORS.FeeUpdate as `0x${string}`] },
        { keys: [EVENT_SELECTORS.AssetRecipientChange as `0x${string}`] },
        { keys: [EVENT_SELECTORS.TokenDeposit as `0x${string}`] },
        { keys: [EVENT_SELECTORS.TokenWithdrawal as `0x${string}`] },
        { keys: [EVENT_SELECTORS.OwnershipTransferred as `0x${string}`] },
        // ERC721 swap events
        { keys: [EVENT_SELECTORS.SwapNFTOutPairIds as `0x${string}`] },
        { keys: [EVENT_SELECTORS.SwapNFTInPairIds as `0x${string}`] },
        { keys: [EVENT_SELECTORS.NFTWithdrawalIds as `0x${string}`] },
        // ERC1155 swap events
        { keys: [EVENT_SELECTORS.SwapNFTOutPairCount as `0x${string}`] },
        { keys: [EVENT_SELECTORS.SwapNFTInPairCount as `0x${string}`] },
        { keys: [EVENT_SELECTORS.NFTWithdrawalCount as `0x${string}`] },
      ],
    },
    plugins: [
      drizzleStorage({
        db: database,
        persistState: true,
        indexerName: "sudoswap",
        idColumn: "id",
        migrate: {
          migrationsFolder: "./migrations",
        },
      }),
    ],
    hooks: {
      "run:before": async () => {
        // Load existing pair addresses from database
        const existingPools = await database.select({ address: schema.pools.address }).from(schema.pools);
        for (const pool of existingPools) {
          knownPairAddresses.add(pool.address.toLowerCase());
        }
        console.log(`[Indexer] Loaded ${knownPairAddresses.size} existing pair addresses`);
      },
      "connect:before": ({ request }) => {
        // Keep connection alive with periodic heartbeats (30 seconds)
        // This prevents the stream from appearing "done" during quiet periods
        request.heartbeatInterval = { seconds: 30n, nanos: 0 };
      },
    },
    async transform({ block }) {
      const logger = useLogger();
      const { db } = useDrizzleStorage();
      const { events, header } = block;

      if (!header) {
        logger.warn("No header in block, skipping");
        return;
      }

      const blockNumber = header.blockNumber ?? 0n;
      const blockTimestamp = header.timestamp ?? new Date();

      for (const event of events) {
        const keys = event.keys ?? [];
        const data = event.data ?? [];
        const transactionHash = event.transactionHash ?? "0x0";
        const eventIndex = event.eventIndex ?? 0;
        const eventAddress = feltToHex(event.address).toLowerCase();

        if (keys.length === 0) continue;

        const selector = feltToHex(keys[0]);

        // Check if this event is from the factory or a known pair
        const isFromFactory = eventAddress === normalizedFactoryAddress;
        const isFromPair = knownPairAddresses.has(eventAddress);

        // Skip events not from factory or known pairs
        if (!isFromFactory && !isFromPair) continue;

        try {
          // ============ Factory Events ============

          if (selector === EVENT_SELECTORS.NewERC721Pair && isFromFactory) {
            const decoded = decodeNewERC721Pair(keys, data);
            logger.info(`NewERC721Pair: ${decoded.poolAddress}, ${decoded.initialIds.length} initial NFTs`);

            // Add to known pairs
            knownPairAddresses.add(decoded.poolAddress.toLowerCase());

            // We need to read pool parameters from the pair contract
            // For now, insert with default values - a separate process can fill in details
            await db.insert(schema.pools).values({
              address: decoded.poolAddress,
              nftAddress: "0x0", // To be filled by reading pair contract
              tokenAddress: "0x0",
              bondingCurve: "0x0",
              poolType: "TRADE",
              nftType: "ERC721",
              spotPrice: "0",
              delta: "0",
              fee: "0",
              owner: "0x0",
              nftCount: decoded.initialIds.length,
              isActive: decoded.initialIds.length > 0,
              createdAt: blockTimestamp,
              blockNumber,
              transactionHash,
            }).onConflictDoUpdate({
              target: schema.pools.address,
              set: {
                nftCount: decoded.initialIds.length,
                updatedAt: blockTimestamp,
              },
            });

            // Add initial NFTs to pool_nfts table
            if (decoded.initialIds.length > 0) {
              const nftRows = decoded.initialIds.map(tokenId => ({
                poolAddress: decoded.poolAddress,
                tokenId: tokenId.toString(),
                blockNumber,
              }));
              await db.insert(schema.poolNfts).values(nftRows).onConflictDoNothing();
            }
          }

          else if (selector === EVENT_SELECTORS.NewERC1155Pair && isFromFactory) {
            const decoded = decodeNewERC1155Pair(keys, data);
            logger.info(`NewERC1155Pair: ${decoded.poolAddress}, balance=${decoded.initialBalance}`);

            // Add to known pairs
            knownPairAddresses.add(decoded.poolAddress.toLowerCase());

            await db.insert(schema.pools).values({
              address: decoded.poolAddress,
              nftAddress: "0x0",
              tokenAddress: "0x0",
              bondingCurve: "0x0",
              poolType: "TRADE",
              nftType: "ERC1155",
              spotPrice: "0",
              delta: "0",
              fee: "0",
              owner: "0x0",
              nftCount: Number(decoded.initialBalance),
              isActive: decoded.initialBalance > 0n,
              createdAt: blockTimestamp,
              blockNumber,
              transactionHash,
            }).onConflictDoUpdate({
              target: schema.pools.address,
              set: {
                nftCount: Number(decoded.initialBalance),
                updatedAt: blockTimestamp,
              },
            });
          }

          else if (selector === EVENT_SELECTORS.ERC20Deposit && isFromFactory) {
            const decoded = decodeERC20Deposit(keys, data);
            logger.info(`ERC20Deposit: pool=${decoded.poolAddress}, amount=${decoded.amount}`);

            // Update pool token balance
            const pool = await db.select().from(schema.pools).where(eq(schema.pools.address, decoded.poolAddress)).limit(1);
            if (pool.length > 0) {
              const currentBalance = BigInt(pool[0].tokenBalance || "0");
              const newBalance = currentBalance + decoded.amount;
              await db.update(schema.pools)
                .set({
                  tokenBalance: newBalance.toString(),
                  isActive: true,
                  updatedAt: blockTimestamp,
                })
                .where(eq(schema.pools.address, decoded.poolAddress));
            }
          }

          else if (selector === EVENT_SELECTORS.NFTDeposit && isFromFactory) {
            const decoded = decodeNFTDeposit(keys, data);
            logger.info(`NFTDeposit: pool=${decoded.poolAddress}, ${decoded.ids.length} NFTs`);

            // Add NFTs to pool
            if (decoded.ids.length > 0) {
              const nftRows = decoded.ids.map(tokenId => ({
                poolAddress: decoded.poolAddress,
                tokenId: tokenId.toString(),
                blockNumber,
              }));
              await db.insert(schema.poolNfts).values(nftRows).onConflictDoNothing();

              // Update pool NFT count
              const pool = await db.select().from(schema.pools).where(eq(schema.pools.address, decoded.poolAddress)).limit(1);
              if (pool.length > 0) {
                const newCount = pool[0].nftCount + decoded.ids.length;
                await db.update(schema.pools)
                  .set({
                    nftCount: newCount,
                    isActive: true,
                    updatedAt: blockTimestamp,
                  })
                  .where(eq(schema.pools.address, decoded.poolAddress));
              }
            }
          }

          else if (selector === EVENT_SELECTORS.ERC1155Deposit && isFromFactory) {
            const decoded = decodeERC1155Deposit(keys, data);
            logger.info(`ERC1155Deposit: pool=${decoded.poolAddress}, id=${decoded.id}, amount=${decoded.amount}`);

            // Update pool NFT count for ERC1155
            const pool = await db.select().from(schema.pools).where(eq(schema.pools.address, decoded.poolAddress)).limit(1);
            if (pool.length > 0) {
              const newCount = pool[0].nftCount + Number(decoded.amount);
              await db.update(schema.pools)
                .set({
                  nftCount: newCount,
                  erc1155Id: decoded.id.toString(),
                  isActive: true,
                  updatedAt: blockTimestamp,
                })
                .where(eq(schema.pools.address, decoded.poolAddress));
            }
          }

          else if (selector === EVENT_SELECTORS.ProtocolFeeRecipientUpdate && isFromFactory) {
            const decoded = decodeProtocolFeeRecipientUpdate(keys, data);
            logger.info(`ProtocolFeeRecipientUpdate: ${decoded.recipientAddress}`);

            await db.insert(schema.protocolSettings).values({
              settingType: "FEE_RECIPIENT",
              address: decoded.recipientAddress,
              value: decoded.recipientAddress,
              blockNumber,
              transactionHash,
              eventIndex,
              timestamp: blockTimestamp,
            }).onConflictDoNothing();
          }

          else if (selector === EVENT_SELECTORS.ProtocolFeeMultiplierUpdate && isFromFactory) {
            const decoded = decodeProtocolFeeMultiplierUpdate(keys, data);
            logger.info(`ProtocolFeeMultiplierUpdate: ${decoded.newMultiplier}`);

            await db.insert(schema.protocolSettings).values({
              settingType: "FEE_MULTIPLIER",
              value: decoded.newMultiplier.toString(),
              blockNumber,
              transactionHash,
              eventIndex,
              timestamp: blockTimestamp,
            }).onConflictDoNothing();
          }

          else if (selector === EVENT_SELECTORS.BondingCurveStatusUpdate && isFromFactory) {
            const decoded = decodeBondingCurveStatusUpdate(keys, data);
            logger.info(`BondingCurveStatusUpdate: ${decoded.bondingCurve} = ${decoded.isAllowed}`);

            await db.insert(schema.protocolSettings).values({
              settingType: "CURVE_STATUS",
              address: decoded.bondingCurve,
              value: decoded.isAllowed ? "true" : "false",
              blockNumber,
              transactionHash,
              eventIndex,
              timestamp: blockTimestamp,
            }).onConflictDoNothing();
          }

          else if (selector === EVENT_SELECTORS.RouterStatusUpdate && isFromFactory) {
            const decoded = decodeRouterStatusUpdate(keys, data);
            logger.info(`RouterStatusUpdate: ${decoded.router} = ${decoded.isAllowed}`);

            await db.insert(schema.protocolSettings).values({
              settingType: "ROUTER_STATUS",
              address: decoded.router,
              value: decoded.isAllowed ? "true" : "false",
              blockNumber,
              transactionHash,
              eventIndex,
              timestamp: blockTimestamp,
            }).onConflictDoNothing();
          }

          // ============ Pair Parameter Events ============

          else if (selector === EVENT_SELECTORS.SpotPriceUpdate && isFromPair) {
            const decoded = decodeSpotPriceUpdate(keys, data);
            logger.info(`SpotPriceUpdate: pool=${eventAddress}, price=${decoded.newSpotPrice}`);

            // Get current value for history
            const pool = await db.select().from(schema.pools).where(eq(schema.pools.address, eventAddress)).limit(1);
            const oldValue = pool.length > 0 ? pool[0].spotPrice : null;

            // Update pool
            await db.update(schema.pools)
              .set({
                spotPrice: decoded.newSpotPrice.toString(),
                updatedAt: blockTimestamp,
              })
              .where(eq(schema.pools.address, eventAddress));

            // Record update history
            await db.insert(schema.poolUpdates).values({
              poolAddress: eventAddress,
              updateType: "SPOT_PRICE",
              oldValue: oldValue?.toString(),
              newValue: decoded.newSpotPrice.toString(),
              blockNumber,
              transactionHash,
              eventIndex,
              timestamp: blockTimestamp,
            }).onConflictDoNothing();
          }

          else if (selector === EVENT_SELECTORS.DeltaUpdate && isFromPair) {
            const decoded = decodeDeltaUpdate(keys, data);
            logger.info(`DeltaUpdate: pool=${eventAddress}, delta=${decoded.newDelta}`);

            const pool = await db.select().from(schema.pools).where(eq(schema.pools.address, eventAddress)).limit(1);
            const oldValue = pool.length > 0 ? pool[0].delta : null;

            await db.update(schema.pools)
              .set({
                delta: decoded.newDelta.toString(),
                updatedAt: blockTimestamp,
              })
              .where(eq(schema.pools.address, eventAddress));

            await db.insert(schema.poolUpdates).values({
              poolAddress: eventAddress,
              updateType: "DELTA",
              oldValue: oldValue?.toString(),
              newValue: decoded.newDelta.toString(),
              blockNumber,
              transactionHash,
              eventIndex,
              timestamp: blockTimestamp,
            }).onConflictDoNothing();
          }

          else if (selector === EVENT_SELECTORS.FeeUpdate && isFromPair) {
            const decoded = decodeFeeUpdate(keys, data);
            logger.info(`FeeUpdate: pool=${eventAddress}, fee=${decoded.newFee}`);

            const pool = await db.select().from(schema.pools).where(eq(schema.pools.address, eventAddress)).limit(1);
            const oldValue = pool.length > 0 ? pool[0].fee : null;

            await db.update(schema.pools)
              .set({
                fee: decoded.newFee.toString(),
                updatedAt: blockTimestamp,
              })
              .where(eq(schema.pools.address, eventAddress));

            await db.insert(schema.poolUpdates).values({
              poolAddress: eventAddress,
              updateType: "FEE",
              oldValue: oldValue?.toString(),
              newValue: decoded.newFee.toString(),
              blockNumber,
              transactionHash,
              eventIndex,
              timestamp: blockTimestamp,
            }).onConflictDoNothing();
          }

          else if (selector === EVENT_SELECTORS.AssetRecipientChange && isFromPair) {
            const decoded = decodeAssetRecipientChange(keys, data);
            logger.info(`AssetRecipientChange: pool=${eventAddress}, recipient=${decoded.newRecipient}`);

            const pool = await db.select().from(schema.pools).where(eq(schema.pools.address, eventAddress)).limit(1);
            const oldValue = pool.length > 0 ? pool[0].assetRecipient : null;

            await db.update(schema.pools)
              .set({
                assetRecipient: decoded.newRecipient,
                updatedAt: blockTimestamp,
              })
              .where(eq(schema.pools.address, eventAddress));

            await db.insert(schema.poolUpdates).values({
              poolAddress: eventAddress,
              updateType: "ASSET_RECIPIENT",
              oldValue,
              newValue: decoded.newRecipient,
              blockNumber,
              transactionHash,
              eventIndex,
              timestamp: blockTimestamp,
            }).onConflictDoNothing();
          }

          else if (selector === EVENT_SELECTORS.TokenDeposit && isFromPair) {
            const decoded = decodeTokenDeposit(keys, data);
            logger.info(`TokenDeposit: pool=${eventAddress}, amount=${decoded.amount}`);

            const pool = await db.select().from(schema.pools).where(eq(schema.pools.address, eventAddress)).limit(1);
            if (pool.length > 0) {
              const currentBalance = BigInt(pool[0].tokenBalance || "0");
              const newBalance = currentBalance + decoded.amount;
              await db.update(schema.pools)
                .set({
                  tokenBalance: newBalance.toString(),
                  isActive: true,
                  updatedAt: blockTimestamp,
                })
                .where(eq(schema.pools.address, eventAddress));
            }
          }

          else if (selector === EVENT_SELECTORS.TokenWithdrawal && isFromPair) {
            const decoded = decodeTokenWithdrawal(keys, data);
            logger.info(`TokenWithdrawal: pool=${eventAddress}, amount=${decoded.amount}`);

            const pool = await db.select().from(schema.pools).where(eq(schema.pools.address, eventAddress)).limit(1);
            if (pool.length > 0) {
              const currentBalance = BigInt(pool[0].tokenBalance || "0");
              const newBalance = currentBalance > decoded.amount ? currentBalance - decoded.amount : 0n;
              await db.update(schema.pools)
                .set({
                  tokenBalance: newBalance.toString(),
                  updatedAt: blockTimestamp,
                })
                .where(eq(schema.pools.address, eventAddress));
            }
          }

          else if (selector === EVENT_SELECTORS.OwnershipTransferred && isFromPair) {
            const decoded = decodeOwnershipTransferred(keys, data);
            logger.info(`OwnershipTransferred: pool=${eventAddress}, ${decoded.previousOwner} -> ${decoded.newOwner}`);

            await db.update(schema.pools)
              .set({
                owner: decoded.newOwner,
                updatedAt: blockTimestamp,
              })
              .where(eq(schema.pools.address, eventAddress));

            await db.insert(schema.poolUpdates).values({
              poolAddress: eventAddress,
              updateType: "OWNER",
              oldValue: decoded.previousOwner,
              newValue: decoded.newOwner,
              blockNumber,
              transactionHash,
              eventIndex,
              timestamp: blockTimestamp,
            }).onConflictDoNothing();
          }

          // ============ ERC721 Swap Events ============

          else if (selector === EVENT_SELECTORS.SwapNFTOutPairIds && isFromPair) {
            const decoded = decodeSwapNFTOutPairIds(keys, data);
            logger.info(`SwapNFTOutPairIds (BUY): pool=${eventAddress}, amount_in=${decoded.amountIn}, ${decoded.ids.length} NFTs`);

            // Insert swap record
            await db.insert(schema.swaps).values({
              poolAddress: eventAddress,
              direction: "BUY",
              tokenAmount: decoded.amountIn.toString(),
              nftCount: decoded.ids.length,
              nftIds: JSON.stringify(decoded.ids.map(id => id.toString())),
              blockNumber,
              transactionHash,
              eventIndex,
              timestamp: blockTimestamp,
            }).onConflictDoNothing();

            // Remove NFTs from pool_nfts
            if (decoded.ids.length > 0) {
              const tokenIdsToRemove = decoded.ids.map(t => t.toString());
              await db.delete(schema.poolNfts)
                .where(
                  and(
                    eq(schema.poolNfts.poolAddress, eventAddress),
                    inArray(schema.poolNfts.tokenId, tokenIdsToRemove)
                  )
                );
            }

            // Update pool NFT count and token balance
            const pool = await db.select().from(schema.pools).where(eq(schema.pools.address, eventAddress)).limit(1);
            if (pool.length > 0) {
              const newNftCount = Math.max(0, pool[0].nftCount - decoded.ids.length);
              const currentTokenBalance = BigInt(pool[0].tokenBalance || "0");
              const newTokenBalance = currentTokenBalance + decoded.amountIn;
              await db.update(schema.pools)
                .set({
                  nftCount: newNftCount,
                  tokenBalance: newTokenBalance.toString(),
                  isActive: newNftCount > 0,
                  updatedAt: blockTimestamp,
                })
                .where(eq(schema.pools.address, eventAddress));
            }
          }

          else if (selector === EVENT_SELECTORS.SwapNFTInPairIds && isFromPair) {
            const decoded = decodeSwapNFTInPairIds(keys, data);
            logger.info(`SwapNFTInPairIds (SELL): pool=${eventAddress}, amount_out=${decoded.amountOut}, ${decoded.ids.length} NFTs`);

            // Insert swap record
            await db.insert(schema.swaps).values({
              poolAddress: eventAddress,
              direction: "SELL",
              tokenAmount: decoded.amountOut.toString(),
              nftCount: decoded.ids.length,
              nftIds: JSON.stringify(decoded.ids.map(id => id.toString())),
              blockNumber,
              transactionHash,
              eventIndex,
              timestamp: blockTimestamp,
            }).onConflictDoNothing();

            // Add NFTs to pool_nfts
            if (decoded.ids.length > 0) {
              const nftRows = decoded.ids.map(tokenId => ({
                poolAddress: eventAddress,
                tokenId: tokenId.toString(),
                blockNumber,
              }));
              await db.insert(schema.poolNfts).values(nftRows).onConflictDoNothing();
            }

            // Update pool NFT count and token balance
            const pool = await db.select().from(schema.pools).where(eq(schema.pools.address, eventAddress)).limit(1);
            if (pool.length > 0) {
              const newNftCount = pool[0].nftCount + decoded.ids.length;
              const currentTokenBalance = BigInt(pool[0].tokenBalance || "0");
              const newTokenBalance = currentTokenBalance > decoded.amountOut
                ? currentTokenBalance - decoded.amountOut
                : 0n;
              await db.update(schema.pools)
                .set({
                  nftCount: newNftCount,
                  tokenBalance: newTokenBalance.toString(),
                  isActive: true,
                  updatedAt: blockTimestamp,
                })
                .where(eq(schema.pools.address, eventAddress));
            }
          }

          else if (selector === EVENT_SELECTORS.NFTWithdrawalIds && isFromPair) {
            const decoded = decodeNFTWithdrawalIds(keys, data);
            logger.info(`NFTWithdrawalIds: pool=${eventAddress}, ${decoded.ids.length} NFTs`);

            // Remove NFTs from pool_nfts
            if (decoded.ids.length > 0) {
              const tokenIdsToRemove = decoded.ids.map(t => t.toString());
              await db.delete(schema.poolNfts)
                .where(
                  and(
                    eq(schema.poolNfts.poolAddress, eventAddress),
                    inArray(schema.poolNfts.tokenId, tokenIdsToRemove)
                  )
                );
            }

            // Update pool NFT count
            const pool = await db.select().from(schema.pools).where(eq(schema.pools.address, eventAddress)).limit(1);
            if (pool.length > 0) {
              const newNftCount = Math.max(0, pool[0].nftCount - decoded.ids.length);
              await db.update(schema.pools)
                .set({
                  nftCount: newNftCount,
                  isActive: newNftCount > 0 || BigInt(pool[0].tokenBalance || "0") > 0n,
                  updatedAt: blockTimestamp,
                })
                .where(eq(schema.pools.address, eventAddress));
            }
          }

          // ============ ERC1155 Swap Events ============

          else if (selector === EVENT_SELECTORS.SwapNFTOutPairCount && isFromPair) {
            const decoded = decodeSwapNFTOutPairCount(keys, data);
            logger.info(`SwapNFTOutPairCount (BUY): pool=${eventAddress}, amount_in=${decoded.amountIn}, ${decoded.numNfts} NFTs`);

            await db.insert(schema.swaps).values({
              poolAddress: eventAddress,
              direction: "BUY",
              tokenAmount: decoded.amountIn.toString(),
              nftCount: Number(decoded.numNfts),
              nftIds: null, // ERC1155 doesn't track individual IDs
              blockNumber,
              transactionHash,
              eventIndex,
              timestamp: blockTimestamp,
            }).onConflictDoNothing();

            // Update pool
            const pool = await db.select().from(schema.pools).where(eq(schema.pools.address, eventAddress)).limit(1);
            if (pool.length > 0) {
              const newNftCount = Math.max(0, pool[0].nftCount - Number(decoded.numNfts));
              const currentTokenBalance = BigInt(pool[0].tokenBalance || "0");
              const newTokenBalance = currentTokenBalance + decoded.amountIn;
              await db.update(schema.pools)
                .set({
                  nftCount: newNftCount,
                  tokenBalance: newTokenBalance.toString(),
                  isActive: newNftCount > 0,
                  updatedAt: blockTimestamp,
                })
                .where(eq(schema.pools.address, eventAddress));
            }
          }

          else if (selector === EVENT_SELECTORS.SwapNFTInPairCount && isFromPair) {
            const decoded = decodeSwapNFTInPairCount(keys, data);
            logger.info(`SwapNFTInPairCount (SELL): pool=${eventAddress}, amount_out=${decoded.amountOut}, ${decoded.numNfts} NFTs`);

            await db.insert(schema.swaps).values({
              poolAddress: eventAddress,
              direction: "SELL",
              tokenAmount: decoded.amountOut.toString(),
              nftCount: Number(decoded.numNfts),
              nftIds: null,
              blockNumber,
              transactionHash,
              eventIndex,
              timestamp: blockTimestamp,
            }).onConflictDoNothing();

            // Update pool
            const pool = await db.select().from(schema.pools).where(eq(schema.pools.address, eventAddress)).limit(1);
            if (pool.length > 0) {
              const newNftCount = pool[0].nftCount + Number(decoded.numNfts);
              const currentTokenBalance = BigInt(pool[0].tokenBalance || "0");
              const newTokenBalance = currentTokenBalance > decoded.amountOut
                ? currentTokenBalance - decoded.amountOut
                : 0n;
              await db.update(schema.pools)
                .set({
                  nftCount: newNftCount,
                  tokenBalance: newTokenBalance.toString(),
                  isActive: true,
                  updatedAt: blockTimestamp,
                })
                .where(eq(schema.pools.address, eventAddress));
            }
          }

          else if (selector === EVENT_SELECTORS.NFTWithdrawalCount && isFromPair) {
            const decoded = decodeNFTWithdrawalCount(keys, data);
            logger.info(`NFTWithdrawalCount: pool=${eventAddress}, ${decoded.numNfts} NFTs`);

            const pool = await db.select().from(schema.pools).where(eq(schema.pools.address, eventAddress)).limit(1);
            if (pool.length > 0) {
              const newNftCount = Math.max(0, pool[0].nftCount - Number(decoded.numNfts));
              await db.update(schema.pools)
                .set({
                  nftCount: newNftCount,
                  isActive: newNftCount > 0 || BigInt(pool[0].tokenBalance || "0") > 0n,
                  updatedAt: blockTimestamp,
                })
                .where(eq(schema.pools.address, eventAddress));
            }
          }

        } catch (error) {
          logger.error(
            `Error processing event at block ${blockNumber}, index ${eventIndex}: ${error}`
          );
          logger.error(`Event selector: ${selector}`);
          logger.error(`From address: ${eventAddress}`);
          logger.error(`Keys: ${JSON.stringify(keys)}`);
          logger.error(`Data: ${JSON.stringify(data)}`);
          // Don't re-throw - let the indexer continue processing other events
        }
      }
    },
  });
}
