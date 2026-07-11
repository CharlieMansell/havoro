# Stage 1: build the React client
FROM node:20-bookworm-slim AS client-builder

WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: production server
FROM node:20-bookworm-slim

WORKDIR /app

# Install native build tooling for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Create a non-root user to run the app
RUN useradd -m -u 1001 havoro

# Install server deps
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Copy server source
COPY server/ ./server/

# Copy built client
COPY --from=client-builder /app/client/dist ./client/dist

# Ensure data and backup directories exist and are owned by the app user
RUN mkdir -p /app/data /app/backups && chown -R havoro:havoro /app

USER havoro

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "require('http').get('http://localhost:3000/api/health', r => r.statusCode === 200 ? process.exit(0) : process.exit(1)).on('error', () => process.exit(1))"

CMD ["node", "server/index.js"]
