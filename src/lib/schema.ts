/**
 * sudoAMM v2 Indexer Database Schema
 *
 * Optimized for:
 * - Efficient indexer writes (minimal table updates per event)
 * - Fast client queries (denormalized for common access patterns)
 * - Reorg handling via Apibara Drizzle plugin
 *
 * Tables:
 * 1. pools - current state of each pool (ERC721 and ERC1155)
 * 2. swaps - all trading activity (buy/sell)
 * 3. pool_nfts - current NFTs in each ERC721 pool
 * 4. pool_updates - history of pool parameter changes
 * 5. protocol_settings - protocol fee and configuration history
 */

import {
  pgTable,
  uuid,
  text,
  bigint,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  numeric,
} from "drizzle-orm/pg-core";

/**
 * Pools table - stores pool creation and current state
 *
 * Populated from:
 * - NewERC721Pair / NewERC1155Pair events (creation)
 * - SpotPriceUpdate, DeltaUpdate, FeeUpdate events (parameter changes)
 * - TokenDeposit, TokenWithdrawal events (balance changes)
 * - SwapNFTInPairIds, SwapNFTOutPairIds events (NFT count changes)
 * - OwnershipTransferred events (owner changes)
 */
export const pools = pgTable(
  "pools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Pool contract address (unique identifier)
    address: text("address").notNull().unique(),
    // NFT collection address
    nftAddress: text("nft_address").notNull(),
    // Payment token address (ETH or ERC20)
    tokenAddress: text("token_address").notNull(),
    // Bonding curve contract address
    bondingCurve: text("bonding_curve").notNull(),
    // Pool type: 'TOKEN', 'NFT', 'TRADE'
    poolType: text("pool_type").notNull(),
    // NFT type: 'ERC721', 'ERC1155'
    nftType: text("nft_type").notNull(),
    // Property checker address (ERC721 pools only, null if none)
    propertyChecker: text("property_checker"),
    // ERC1155 token ID (ERC1155 pools only)
    erc1155Id: numeric("erc1155_id", { precision: 78, scale: 0 }),
    // Current spot price (u128 stored as numeric for precision)
    spotPrice: numeric("spot_price", { precision: 78, scale: 0 }).notNull(),
    // Bonding curve delta parameter
    delta: numeric("delta", { precision: 78, scale: 0 }).notNull(),
    // Trade fee (only for TRADE pools)
    fee: numeric("fee", { precision: 78, scale: 0 }).notNull(),
    // Pool owner address
    owner: text("owner").notNull(),
    // Asset recipient address (null means owner)
    assetRecipient: text("asset_recipient"),
    // Current token balance in pool
    tokenBalance: numeric("token_balance", { precision: 78, scale: 0 })
      .notNull()
      .default("0"),
    // Current NFT count in pool
    nftCount: integer("nft_count").notNull().default(0),
    // Whether pool is active (has liquidity)
    isActive: boolean("is_active").notNull().default(true),
    // Timestamps
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
    // Block info for reorg handling
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    transactionHash: text("transaction_hash").notNull(),
  },
  (table) => [
    index("pools_nft_address_idx").on(table.nftAddress),
    index("pools_token_address_idx").on(table.tokenAddress),
    index("pools_owner_idx").on(table.owner),
    index("pools_bonding_curve_idx").on(table.bondingCurve),
    index("pools_nft_type_idx").on(table.nftType),
    index("pools_pool_type_idx").on(table.poolType),
    index("pools_is_active_idx").on(table.isActive),
    index("pools_created_at_idx").on(table.createdAt),
    // Composite indexes for common queries
    index("pools_nft_active_idx").on(table.nftAddress, table.isActive),
    index("pools_nft_type_active_idx").on(table.nftType, table.isActive),
  ]
);

/**
 * Swaps table - all trading activity
 *
 * Populated from:
 * - SwapNFTOutPairIds / SwapNFTOutPairCount (BUY: tokens in, NFTs out)
 * - SwapNFTInPairIds / SwapNFTInPairCount (SELL: NFTs in, tokens out)
 */
export const swaps = pgTable(
  "swaps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Pool contract address
    poolAddress: text("pool_address").notNull(),
    // Direction: 'BUY' (tokens -> NFTs) or 'SELL' (NFTs -> tokens)
    direction: text("direction").notNull(),
    // Token amount (amount_in for BUY, amount_out for SELL)
    tokenAmount: numeric("token_amount", { precision: 78, scale: 0 }).notNull(),
    // Number of NFTs swapped
    nftCount: integer("nft_count").notNull(),
    // NFT IDs as JSON array string (ERC721 only, null for ERC1155)
    nftIds: text("nft_ids"),
    // Block info
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    transactionHash: text("transaction_hash").notNull(),
    eventIndex: integer("event_index").notNull(),
    timestamp: timestamp("timestamp").defaultNow(),
  },
  (table) => [
    // Unique constraint for idempotent re-indexing
    uniqueIndex("swaps_block_tx_event_idx").on(
      table.blockNumber,
      table.transactionHash,
      table.eventIndex
    ),
    index("swaps_pool_address_idx").on(table.poolAddress),
    index("swaps_timestamp_idx").on(table.timestamp),
    index("swaps_direction_idx").on(table.direction),
    index("swaps_block_number_idx").on(table.blockNumber),
    // Activity feed: pool + time
    index("swaps_pool_timestamp_idx").on(table.poolAddress, table.timestamp),
  ]
);

/**
 * Pool NFTs table - current NFTs in each ERC721 pool
 *
 * Maintained by:
 * - NewERC721Pair event (initial NFTs from factory deposit)
 * - SwapNFTOutPairIds event (NFTs removed on buy)
 * - SwapNFTInPairIds event (NFTs added on sell)
 * - NFTWithdrawalIds event (owner withdrawal)
 * - NFTDeposit event (additional deposits via factory)
 */
export const poolNfts = pgTable(
  "pool_nfts",
  {
    // Required by Apibara's Drizzle plugin for reorg handling
    id: uuid("id").primaryKey().defaultRandom(),
    // Pool contract address
    poolAddress: text("pool_address").notNull(),
    // NFT token ID (u256 as string for full precision)
    tokenId: numeric("token_id", { precision: 78, scale: 0 }).notNull(),
    // When the NFT was added to the pool
    addedAt: timestamp("added_at").defaultNow().notNull(),
    // Block info for reorg handling
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
  },
  (table) => [
    // Unique constraint prevents duplicate entries on re-index
    uniqueIndex("pool_nfts_pool_token_idx").on(table.poolAddress, table.tokenId),
    index("pool_nfts_token_id_idx").on(table.tokenId),
    index("pool_nfts_pool_added_idx").on(table.poolAddress, table.addedAt),
    index("pool_nfts_block_number_idx").on(table.blockNumber),
  ]
);

/**
 * Pool updates table - history of pool parameter changes
 *
 * Records changes from:
 * - SpotPriceUpdate event
 * - DeltaUpdate event
 * - FeeUpdate event
 * - AssetRecipientChange event
 * - OwnershipTransferred event
 */
export const poolUpdates = pgTable(
  "pool_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Pool contract address
    poolAddress: text("pool_address").notNull(),
    // Type of update: 'SPOT_PRICE', 'DELTA', 'FEE', 'ASSET_RECIPIENT', 'OWNER'
    updateType: text("update_type").notNull(),
    // Previous value (null for initial state or if unknown)
    oldValue: text("old_value"),
    // New value
    newValue: text("new_value").notNull(),
    // Block info
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    transactionHash: text("transaction_hash").notNull(),
    eventIndex: integer("event_index").notNull(),
    timestamp: timestamp("timestamp").defaultNow(),
  },
  (table) => [
    // Unique constraint for idempotent re-indexing
    uniqueIndex("pool_updates_block_tx_event_idx").on(
      table.blockNumber,
      table.transactionHash,
      table.eventIndex
    ),
    index("pool_updates_pool_address_idx").on(table.poolAddress),
    index("pool_updates_update_type_idx").on(table.updateType),
    index("pool_updates_timestamp_idx").on(table.timestamp),
    index("pool_updates_block_number_idx").on(table.blockNumber),
  ]
);

/**
 * Protocol settings table - protocol configuration history
 *
 * Records changes from:
 * - ProtocolFeeRecipientUpdate event
 * - ProtocolFeeMultiplierUpdate event
 * - BondingCurveStatusUpdate event
 * - RouterStatusUpdate event
 */
export const protocolSettings = pgTable(
  "protocol_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Setting type: 'FEE_RECIPIENT', 'FEE_MULTIPLIER', 'CURVE_STATUS', 'ROUTER_STATUS'
    settingType: text("setting_type").notNull(),
    // Related address (curve/router address for status updates, recipient for fee)
    address: text("address"),
    // Setting value (recipient address, multiplier, or 'true'/'false' for status)
    value: text("value").notNull(),
    // Block info
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    transactionHash: text("transaction_hash").notNull(),
    eventIndex: integer("event_index").notNull(),
    timestamp: timestamp("timestamp").defaultNow(),
  },
  (table) => [
    // Unique constraint for idempotent re-indexing
    uniqueIndex("protocol_settings_block_tx_event_idx").on(
      table.blockNumber,
      table.transactionHash,
      table.eventIndex
    ),
    index("protocol_settings_setting_type_idx").on(table.settingType),
    index("protocol_settings_block_number_idx").on(table.blockNumber),
  ]
);

// Export all schema tables for Drizzle
export const schema = {
  pools,
  swaps,
  poolNfts,
  poolUpdates,
  protocolSettings,
};
