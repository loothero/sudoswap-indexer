/**
 * sudoAMM v2 Event Decoder Utilities
 *
 * Provides helper functions for decoding Starknet event data from felt252 arrays.
 * Cairo types are serialized as follows:
 * - felt252: 1 field element
 * - u128: 1 field element
 * - u64: 1 field element
 * - bool: 1 field element (0 or 1)
 * - u256: 2 field elements (low, high)
 * - ContractAddress: 1 field element
 * - Span<T>: length + T elements
 *
 * Event Model:
 * - Factory Events: Pool creation, deposits, protocol settings
 * - Pair Events: Parameter updates, token transfers
 * - Swap Events: NFT buy/sell with IDs (ERC721) or counts (ERC1155)
 */

import { getSelector } from "@apibara/starknet";

// ============ Event Selectors ============

/**
 * Event selectors computed using Apibara's getSelector (padded format)
 * These must match the Cairo event names exactly
 *
 * IMPORTANT: Uses @apibara/starknet getSelector which produces zero-padded
 * 64-character hex strings (0x + 64 chars). This format is required for
 * Apibara filter matching.
 */
export const EVENT_SELECTORS = {
  // Factory events (emitted by LSSVMPairFactory)
  NewERC721Pair: getSelector("NewERC721Pair"),
  NewERC1155Pair: getSelector("NewERC1155Pair"),
  ERC20Deposit: getSelector("ERC20Deposit"),
  NFTDeposit: getSelector("NFTDeposit"),
  ERC1155Deposit: getSelector("ERC1155Deposit"),
  ProtocolFeeRecipientUpdate: getSelector("ProtocolFeeRecipientUpdate"),
  ProtocolFeeMultiplierUpdate: getSelector("ProtocolFeeMultiplierUpdate"),
  BondingCurveStatusUpdate: getSelector("BondingCurveStatusUpdate"),
  RouterStatusUpdate: getSelector("RouterStatusUpdate"),
  CallTargetStatusUpdate: getSelector("CallTargetStatusUpdate"),

  // Pair parameter events (emitted by LSSVMPairERC721/ERC1155)
  SpotPriceUpdate: getSelector("SpotPriceUpdate"),
  DeltaUpdate: getSelector("DeltaUpdate"),
  FeeUpdate: getSelector("FeeUpdate"),
  AssetRecipientChange: getSelector("AssetRecipientChange"),
  TokenDeposit: getSelector("TokenDeposit"),
  TokenWithdrawal: getSelector("TokenWithdrawal"),
  OwnershipTransferred: getSelector("OwnershipTransferred"),

  // ERC721 swap events
  SwapNFTOutPairIds: getSelector("SwapNFTOutPairIds"),
  SwapNFTInPairIds: getSelector("SwapNFTInPairIds"),
  NFTWithdrawalIds: getSelector("NFTWithdrawalIds"),

  // ERC1155 swap events
  SwapNFTOutPairCount: getSelector("SwapNFTOutPairCount"),
  SwapNFTInPairCount: getSelector("SwapNFTInPairCount"),
  NFTWithdrawalCount: getSelector("NFTWithdrawalCount"),
} as const;

// ============ Primitive Decoders ============

// Type alias for readonly string arrays from Apibara
type ReadonlyStringArray = readonly string[];

/**
 * Convert a hex string to bigint, handling null/undefined
 */
export function hexToBigInt(hex: string | undefined | null): bigint {
  if (!hex) return 0n;
  return BigInt(hex);
}

/**
 * Decode a u256 from two felt252s (low, high)
 * Cairo u256 = { low: u128, high: u128 }
 */
export function decodeU256(low: string | undefined, high: string | undefined): bigint {
  const lowVal = hexToBigInt(low);
  const highVal = hexToBigInt(high);
  return (highVal << 128n) + lowVal;
}

/**
 * Convert felt252 to normalized hex string (padded format)
 * Returns zero-padded 64-character hex string (0x + 64 chars)
 * This format matches Apibara's getSelector output for consistent comparison
 */
export function feltToHex(felt: string | undefined | null): string {
  if (!felt) return "0x" + "0".repeat(64);
  return `0x${BigInt(felt).toString(16).padStart(64, "0")}`;
}

/**
 * Decode bool from felt252 (0 = false, 1 = true)
 */
export function decodeBool(felt: string | undefined): boolean {
  return hexToBigInt(felt) === 1n;
}

/**
 * Decode a Span<u256> from data array
 * Format: [length, token1_low, token1_high, token2_low, token2_high, ...]
 * Returns: array of bigint token IDs and the number of elements consumed
 */
export function decodeSpanU256(
  data: ReadonlyStringArray,
  startIndex: number
): { tokens: bigint[]; consumed: number } {
  const length = Number(hexToBigInt(data[startIndex]));
  const tokens: bigint[] = [];
  let idx = startIndex + 1;

  for (let i = 0; i < length; i++) {
    tokens.push(decodeU256(data[idx], data[idx + 1]));
    idx += 2;
  }

  return { tokens, consumed: 1 + length * 2 };
}

// ============ Event Data Interfaces ============

export interface NewERC721PairEvent {
  poolAddress: string;
  initialIds: bigint[];
}

export interface NewERC1155PairEvent {
  poolAddress: string;
  initialBalance: bigint;
}

export interface ERC20DepositEvent {
  poolAddress: string;
  amount: bigint;
}

export interface NFTDepositEvent {
  poolAddress: string;
  ids: bigint[];
}

export interface ERC1155DepositEvent {
  poolAddress: string;
  id: bigint;
  amount: bigint;
}

export interface ProtocolFeeRecipientUpdateEvent {
  recipientAddress: string;
}

export interface ProtocolFeeMultiplierUpdateEvent {
  newMultiplier: bigint;
}

export interface BondingCurveStatusUpdateEvent {
  bondingCurve: string;
  isAllowed: boolean;
}

export interface RouterStatusUpdateEvent {
  router: string;
  isAllowed: boolean;
}

export interface SpotPriceUpdateEvent {
  newSpotPrice: bigint;
}

export interface DeltaUpdateEvent {
  newDelta: bigint;
}

export interface FeeUpdateEvent {
  newFee: bigint;
}

export interface AssetRecipientChangeEvent {
  newRecipient: string;
}

export interface TokenDepositEvent {
  amount: bigint;
}

export interface TokenWithdrawalEvent {
  amount: bigint;
}

export interface OwnershipTransferredEvent {
  previousOwner: string;
  newOwner: string;
}

export interface SwapNFTOutPairIdsEvent {
  amountIn: bigint;
  ids: bigint[];
}

export interface SwapNFTInPairIdsEvent {
  amountOut: bigint;
  ids: bigint[];
}

export interface NFTWithdrawalIdsEvent {
  ids: bigint[];
}

export interface SwapNFTOutPairCountEvent {
  amountIn: bigint;
  numNfts: bigint;
}

export interface SwapNFTInPairCountEvent {
  amountOut: bigint;
  numNfts: bigint;
}

export interface NFTWithdrawalCountEvent {
  numNfts: bigint;
}

// ============ Factory Event Decoders ============

/**
 * Decode NewERC721Pair event
 * Keys: [selector, pool_address]
 * Data: [initial_ids...] (Span<u256>)
 */
export function decodeNewERC721Pair(keys: ReadonlyStringArray, data: ReadonlyStringArray): NewERC721PairEvent {
  const { tokens: initialIds } = decodeSpanU256(data, 0);
  return {
    poolAddress: feltToHex(keys[1]),
    initialIds,
  };
}

/**
 * Decode NewERC1155Pair event
 * Keys: [selector, pool_address]
 * Data: [initial_balance_low, initial_balance_high]
 */
export function decodeNewERC1155Pair(keys: ReadonlyStringArray, data: ReadonlyStringArray): NewERC1155PairEvent {
  return {
    poolAddress: feltToHex(keys[1]),
    initialBalance: decodeU256(data[0], data[1]),
  };
}

/**
 * Decode ERC20Deposit event
 * Keys: [selector, pool_address]
 * Data: [amount_low, amount_high]
 */
export function decodeERC20Deposit(keys: ReadonlyStringArray, data: ReadonlyStringArray): ERC20DepositEvent {
  return {
    poolAddress: feltToHex(keys[1]),
    amount: decodeU256(data[0], data[1]),
  };
}

/**
 * Decode NFTDeposit event
 * Keys: [selector, pool_address]
 * Data: [ids...] (Span<u256>)
 */
export function decodeNFTDeposit(keys: ReadonlyStringArray, data: ReadonlyStringArray): NFTDepositEvent {
  const { tokens: ids } = decodeSpanU256(data, 0);
  return {
    poolAddress: feltToHex(keys[1]),
    ids,
  };
}

/**
 * Decode ERC1155Deposit event
 * Keys: [selector, pool_address, id_low, id_high]
 * Data: [amount_low, amount_high]
 */
export function decodeERC1155Deposit(keys: ReadonlyStringArray, data: ReadonlyStringArray): ERC1155DepositEvent {
  return {
    poolAddress: feltToHex(keys[1]),
    id: decodeU256(keys[2], keys[3]),
    amount: decodeU256(data[0], data[1]),
  };
}

/**
 * Decode ProtocolFeeRecipientUpdate event
 * Keys: [selector, recipient_address]
 * Data: []
 */
export function decodeProtocolFeeRecipientUpdate(
  keys: ReadonlyStringArray,
  _data: ReadonlyStringArray
): ProtocolFeeRecipientUpdateEvent {
  return {
    recipientAddress: feltToHex(keys[1]),
  };
}

/**
 * Decode ProtocolFeeMultiplierUpdate event
 * Keys: [selector]
 * Data: [new_multiplier_low, new_multiplier_high]
 */
export function decodeProtocolFeeMultiplierUpdate(
  _keys: ReadonlyStringArray,
  data: ReadonlyStringArray
): ProtocolFeeMultiplierUpdateEvent {
  return {
    newMultiplier: decodeU256(data[0], data[1]),
  };
}

/**
 * Decode BondingCurveStatusUpdate event
 * Keys: [selector, bonding_curve]
 * Data: [is_allowed]
 */
export function decodeBondingCurveStatusUpdate(
  keys: ReadonlyStringArray,
  data: ReadonlyStringArray
): BondingCurveStatusUpdateEvent {
  return {
    bondingCurve: feltToHex(keys[1]),
    isAllowed: decodeBool(data[0]),
  };
}

/**
 * Decode RouterStatusUpdate event
 * Keys: [selector, router]
 * Data: [is_allowed]
 */
export function decodeRouterStatusUpdate(
  keys: ReadonlyStringArray,
  data: ReadonlyStringArray
): RouterStatusUpdateEvent {
  return {
    router: feltToHex(keys[1]),
    isAllowed: decodeBool(data[0]),
  };
}

// ============ Pair Parameter Event Decoders ============

/**
 * Decode SpotPriceUpdate event
 * Keys: [selector, new_spot_price]
 * Data: []
 */
export function decodeSpotPriceUpdate(keys: ReadonlyStringArray, _data: ReadonlyStringArray): SpotPriceUpdateEvent {
  return {
    newSpotPrice: hexToBigInt(keys[1]),
  };
}

/**
 * Decode DeltaUpdate event
 * Keys: [selector, new_delta]
 * Data: []
 */
export function decodeDeltaUpdate(keys: ReadonlyStringArray, _data: ReadonlyStringArray): DeltaUpdateEvent {
  return {
    newDelta: hexToBigInt(keys[1]),
  };
}

/**
 * Decode FeeUpdate event
 * Keys: [selector, new_fee]
 * Data: []
 */
export function decodeFeeUpdate(keys: ReadonlyStringArray, _data: ReadonlyStringArray): FeeUpdateEvent {
  return {
    newFee: hexToBigInt(keys[1]),
  };
}

/**
 * Decode AssetRecipientChange event
 * Keys: [selector, new_recipient]
 * Data: []
 */
export function decodeAssetRecipientChange(
  keys: ReadonlyStringArray,
  _data: ReadonlyStringArray
): AssetRecipientChangeEvent {
  return {
    newRecipient: feltToHex(keys[1]),
  };
}

/**
 * Decode TokenDeposit event
 * Keys: [selector]
 * Data: [amount_low, amount_high]
 */
export function decodeTokenDeposit(_keys: ReadonlyStringArray, data: ReadonlyStringArray): TokenDepositEvent {
  return {
    amount: decodeU256(data[0], data[1]),
  };
}

/**
 * Decode TokenWithdrawal event
 * Keys: [selector]
 * Data: [amount_low, amount_high]
 */
export function decodeTokenWithdrawal(_keys: ReadonlyStringArray, data: ReadonlyStringArray): TokenWithdrawalEvent {
  return {
    amount: decodeU256(data[0], data[1]),
  };
}

/**
 * Decode OwnershipTransferred event
 * Keys: [selector, previous_owner, new_owner]
 * Data: []
 */
export function decodeOwnershipTransferred(
  keys: ReadonlyStringArray,
  _data: ReadonlyStringArray
): OwnershipTransferredEvent {
  return {
    previousOwner: feltToHex(keys[1]),
    newOwner: feltToHex(keys[2]),
  };
}

// ============ ERC721 Swap Event Decoders ============

/**
 * Decode SwapNFTOutPairIds event (BUY: user buys NFTs from pool)
 * Keys: [selector]
 * Data: [amount_in_low, amount_in_high, ids...] (Span<u256>)
 */
export function decodeSwapNFTOutPairIds(
  _keys: ReadonlyStringArray,
  data: ReadonlyStringArray
): SwapNFTOutPairIdsEvent {
  const amountIn = decodeU256(data[0], data[1]);
  const { tokens: ids } = decodeSpanU256(data, 2);
  return {
    amountIn,
    ids,
  };
}

/**
 * Decode SwapNFTInPairIds event (SELL: user sells NFTs to pool)
 * Keys: [selector]
 * Data: [amount_out_low, amount_out_high, ids...] (Span<u256>)
 */
export function decodeSwapNFTInPairIds(
  _keys: ReadonlyStringArray,
  data: ReadonlyStringArray
): SwapNFTInPairIdsEvent {
  const amountOut = decodeU256(data[0], data[1]);
  const { tokens: ids } = decodeSpanU256(data, 2);
  return {
    amountOut,
    ids,
  };
}

/**
 * Decode NFTWithdrawalIds event
 * Keys: [selector]
 * Data: [ids...] (Span<u256>)
 */
export function decodeNFTWithdrawalIds(_keys: ReadonlyStringArray, data: ReadonlyStringArray): NFTWithdrawalIdsEvent {
  const { tokens: ids } = decodeSpanU256(data, 0);
  return {
    ids,
  };
}

// ============ ERC1155 Swap Event Decoders ============

/**
 * Decode SwapNFTOutPairCount event (BUY: user buys NFTs from pool)
 * Keys: [selector]
 * Data: [amount_in_low, amount_in_high, num_nfts_low, num_nfts_high]
 */
export function decodeSwapNFTOutPairCount(
  _keys: ReadonlyStringArray,
  data: ReadonlyStringArray
): SwapNFTOutPairCountEvent {
  return {
    amountIn: decodeU256(data[0], data[1]),
    numNfts: decodeU256(data[2], data[3]),
  };
}

/**
 * Decode SwapNFTInPairCount event (SELL: user sells NFTs to pool)
 * Keys: [selector]
 * Data: [amount_out_low, amount_out_high, num_nfts_low, num_nfts_high]
 */
export function decodeSwapNFTInPairCount(
  _keys: ReadonlyStringArray,
  data: ReadonlyStringArray
): SwapNFTInPairCountEvent {
  return {
    amountOut: decodeU256(data[0], data[1]),
    numNfts: decodeU256(data[2], data[3]),
  };
}

/**
 * Decode NFTWithdrawalCount event
 * Keys: [selector]
 * Data: [num_nfts_low, num_nfts_high]
 */
export function decodeNFTWithdrawalCount(
  _keys: ReadonlyStringArray,
  data: ReadonlyStringArray
): NFTWithdrawalCountEvent {
  return {
    numNfts: decodeU256(data[0], data[1]),
  };
}
