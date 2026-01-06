# sudoAMM v2 Indexer

Starknet event indexer for sudoAMM v2 (Cairo) using [Apibara](https://apibara.com).

## Overview

This indexer tracks all events emitted by the sudoAMM v2 contracts deployed on Starknet mainnet:

- **Factory Events**: Pool creation (`NewERC721Pair`, `NewERC1155Pair`), deposits, protocol settings
- **Pair Events**: Parameter updates (`SpotPriceUpdate`, `DeltaUpdate`, `FeeUpdate`), ownership
- **Swap Events**: Buy/sell trades with NFT IDs (ERC721) or counts (ERC1155)
- **Withdrawal Events**: Token and NFT withdrawals

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Apibara API key (get one at https://apibara.com)

## Installation

```bash
npm install
```

## Configuration

Copy the environment template and configure:

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# PostgreSQL connection string
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sudoswap

# Apibara DNA stream URL (default is mainnet)
APIBARA_STREAM_URL=https://starknet.apibara.com

# Factory contract address (mainnet deployment)
FACTORY_ADDRESS=0x06ddd1b3ad87f0f09662b9156d5d5123bf8f9303a58524505f90b5822b742a6a

# Starting block (before factory deployment)
STARTING_BLOCK=850000
```

## Database Setup

Create the database and run migrations:

```bash
# Create database (if not exists)
createdb sudoswap

# Apply migrations
npm run db:push

# Or generate and apply migrations separately
npm run db:generate
npm run db:migrate
```

## Running the Indexer

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

## Docker Deployment

### Local Development with Docker Compose

The easiest way to run the full stack locally:

```bash
# Start PostgreSQL + indexer
docker compose up -d

# View logs
docker compose logs -f indexer

# Stop all services
docker compose down

# Stop and remove all data
docker compose down -v
```

Environment variables can be set in a `.env` file or passed directly:

```bash
# With custom Apibara token
DNA_TOKEN=your_token docker compose up -d
```

### Optional: pgAdmin UI

For database management via web UI:

```bash
docker compose --profile admin up -d
# Access at http://localhost:5050 (admin@sudoswap.xyz / admin)
```

### Build Docker Image Manually

```bash
docker build -t sudoswap-indexer .
docker run -d \
  -e DATABASE_URL=postgres://user:pass@host:5432/sudoswap \
  -e DNA_TOKEN=your_token \
  sudoswap-indexer
```

## Render Deployment

Deploy to [Render](https://render.com) with one click using the included `render.yaml` blueprint.

### Quick Start

1. Fork this repository
2. Connect your fork to Render
3. Create a new Blueprint from `render.yaml`
4. Set the `DNA_TOKEN` secret in the Render dashboard

### What Gets Deployed

| Service | Type | Cost |
|---------|------|------|
| `sudoswap-db` | PostgreSQL | ~$7/mo (basic-256mb) |
| `sudoswap-indexer` | Background Worker | ~$7/mo (starter) |

### Environment Variables

Set these in the Render dashboard under Environment:

| Variable | Required | Description |
|----------|----------|-------------|
| `DNA_TOKEN` | Yes | Apibara authentication token |
| `STARTING_BLOCK` | No | Override starting block (default: 850000) |
| `FACTORY_ADDRESS` | No | Override factory address |

### Scaling for Production

Edit `render.yaml` to upgrade plans:

```yaml
# Database: upgrade to standard-1gb ($50/mo)
databases:
  - name: sudoswap-db
    plan: standard-1gb

# Indexer: upgrade to standard ($25/mo)
services:
  - type: worker
    name: sudoswap-indexer
    plan: standard
```

### Adding an API Server

The `render.yaml` includes a commented-out API server configuration. Uncomment and configure when ready to serve data via REST endpoints.

## Database Schema

### Tables

| Table | Description |
|-------|-------------|
| `pools` | Pool state and metadata (address, curve, prices, balances) |
| `swaps` | All trading activity (buys/sells with amounts and NFT IDs) |
| `pool_nfts` | Current NFT inventory for ERC721 pools |
| `pool_updates` | History of parameter changes (spot price, delta, fee) |
| `protocol_settings` | Protocol configuration history (fee recipient, multiplier) |

### Key Queries

```sql
-- Get all active pools for an NFT collection
SELECT * FROM pools
WHERE nft_address = '0x...' AND is_active = true;

-- Get recent swaps for a pool
SELECT * FROM swaps
WHERE pool_address = '0x...'
ORDER BY timestamp DESC LIMIT 10;

-- Get NFT IDs in a pool
SELECT token_id FROM pool_nfts
WHERE pool_address = '0x...';

-- Get pool parameter history
SELECT * FROM pool_updates
WHERE pool_address = '0x...'
ORDER BY block_number DESC;
```

## Architecture

```
┌─────────────────┐     ┌───────────────┐     ┌──────────────┐
│   Apibara DNA   │────▶│   Indexer     │────▶│  PostgreSQL  │
│  (Starknet)     │     │  (Transform)  │     │  (Storage)   │
└─────────────────┘     └───────────────┘     └──────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Event Decoder  │
                    │  (decoder.ts)   │
                    └─────────────────┘
```

### Event Flow

1. **Factory Events** are filtered by Factory contract address
2. **Pair Events** are filtered by tracking pool addresses from `NewERC721Pair`/`NewERC1155Pair` events
3. All events are decoded using type-specific decoders in `decoder.ts`
4. State is persisted to PostgreSQL via Drizzle ORM

## Contract Addresses (Mainnet)

| Contract | Address |
|----------|---------|
| Factory | `0x06ddd1b3ad87f0f09662b9156d5d5123bf8f9303a58524505f90b5822b742a6a` |
| LinearCurve | `0x0038597e953b2a6264389827814017cea62aed77d62b96597b0ed19da2b22a3f` |
| ExponentialCurve | `0x0753b08b10d2c9befac535a6fd68fdb946ca7d9e2406425e14947c70211ce759` |
| XykCurve | `0x000a75915f4080352110d228bfddf0ef7ab536edbfcf1100c1b8fbd115f443f3` |
| GDACurve | `0x00bc99964d8fc98550980ec6bb52fab449aafed3092047162367e443be7fab27` |

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start indexer in development mode |
| `npm run build` | Build TypeScript to JavaScript |
| `npm start` | Run built indexer |
| `npm run db:generate` | Generate SQL migrations |
| `npm run db:push` | Push schema changes to database |
| `npm run check-dna` | Check DNA server health |

## Event Reference

### Factory Events

| Event | Keys | Data |
|-------|------|------|
| `NewERC721Pair` | `[selector, pool_address]` | `[initial_ids...]` (Span<u256>) |
| `NewERC1155Pair` | `[selector, pool_address]` | `[initial_balance_low, initial_balance_high]` |
| `ERC20Deposit` | `[selector, pool_address]` | `[amount_low, amount_high]` |
| `NFTDeposit` | `[selector, pool_address]` | `[ids...]` (Span<u256>) |
| `ERC1155Deposit` | `[selector, pool_address, id_low, id_high]` | `[amount_low, amount_high]` |

### Pair Events

| Event | Keys | Data |
|-------|------|------|
| `SpotPriceUpdate` | `[selector, new_spot_price]` | - |
| `DeltaUpdate` | `[selector, new_delta]` | - |
| `FeeUpdate` | `[selector, new_fee]` | - |
| `TokenDeposit` | `[selector]` | `[amount_low, amount_high]` |
| `TokenWithdrawal` | `[selector]` | `[amount_low, amount_high]` |

### Swap Events (ERC721)

| Event | Keys | Data |
|-------|------|------|
| `SwapNFTOutPairIds` | `[selector]` | `[amount_in_low, amount_in_high, ids...]` |
| `SwapNFTInPairIds` | `[selector]` | `[amount_out_low, amount_out_high, ids...]` |
| `NFTWithdrawalIds` | `[selector]` | `[ids...]` |

### Swap Events (ERC1155)

| Event | Keys | Data |
|-------|------|------|
| `SwapNFTOutPairCount` | `[selector]` | `[amount_in_low, amount_in_high, num_nfts_low, num_nfts_high]` |
| `SwapNFTInPairCount` | `[selector]` | `[amount_out_low, amount_out_high, num_nfts_low, num_nfts_high]` |
| `NFTWithdrawalCount` | `[selector]` | `[num_nfts_low, num_nfts_high]` |

## Troubleshooting

### Common Issues

**Connection refused to DNA server**
- Check your API key is valid
- Verify `APIBARA_STREAM_URL` is correct

**Database connection failed**
- Ensure PostgreSQL is running
- Verify `DATABASE_URL` credentials

**Missing events**
- Check `STARTING_BLOCK` is set before first contract deployment
- Verify `FACTORY_ADDRESS` matches the deployed contract

## License

MIT
