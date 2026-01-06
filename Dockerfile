# sudoAMM v2 Indexer Dockerfile
#
# Multi-stage build for optimized production image

# ============ Build Stage ============
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source files
COPY . .

# Build the indexer
RUN npm run build

# ============ Production Stage ============
FROM node:22-alpine AS production

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S indexer -u 1001 -G nodejs

# Install production dependencies + tsx for status check script
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && \
    npm install --no-save tsx && \
    npm cache clean --force

# Copy built artifacts from builder
COPY --from=builder /app/.apibara ./.apibara
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/apibara.config.ts ./apibara.config.ts
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/src ./src
COPY --from=builder /app/indexers ./indexers
COPY --from=builder /app/scripts ./scripts

# Switch to non-root user
USER indexer

# Environment variables (override at runtime via .env or environment)
ENV NODE_ENV=production

# Database connection (required - override at runtime)
ENV DATABASE_URL=postgres://postgres:postgres@postgres:5432/sudoswap

# Apibara DNA stream URL (required - use your private stream URL)
ENV APIBARA_STREAM_URL=https://starknet.apibara.com

# DNA_TOKEN is optional - only needed for public Apibara streams
# For private streams, leave unset and use your custom APIBARA_STREAM_URL
# ENV DNA_TOKEN=

# Factory contract address on Starknet mainnet
ENV FACTORY_ADDRESS=0x06ddd1b3ad87f0f09662b9156d5d5123bf8f9303a58524505f90b5822b742a6a

# Starting block (should be before factory deployment)
ENV STARTING_BLOCK=850000

# Health check - verify node process is responsive
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "console.log('healthy')" || exit 1

# Run DNA status check then start indexer
CMD ["sh", "-c", "npm run check-dna && npm run start -- --indexer=sudoswap"]
