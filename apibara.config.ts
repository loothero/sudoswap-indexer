/**
 * Apibara Indexer Configuration
 *
 * Runtime configuration for the sudoAMM v2 indexer.
 * Environment variables should be set in .env file or environment.
 */

export default {
  runtimeConfig: {
    sudoswap: {
      // Factory contract address on Starknet mainnet
      factoryAddress:
        process.env.FACTORY_ADDRESS ||
        "0x06ddd1b3ad87f0f09662b9156d5d5123bf8f9303a58524505f90b5822b742a6a",

      // Apibara DNA stream URL
      streamUrl:
        process.env.APIBARA_STREAM_URL ||
        "https://starknet.apibara.com",

      // Starting block (should be before factory deployment)
      // Mainnet deployment was on 2026-01-06, adjust block number as needed
      startingBlock: process.env.STARTING_BLOCK || "850000",

      // PostgreSQL connection string
      databaseUrl:
        process.env.DATABASE_URL ||
        "postgresql://postgres:postgres@localhost:5432/sudoswap",
    },
  },
};
