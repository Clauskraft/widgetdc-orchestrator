FROM node:20-alpine AS builder

WORKDIR /app

# Copy contracts (needed at build time for esbuild to resolve)
COPY ../widgetdc-contracts /contracts

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY build.mjs ./

# Install all deps (including devDeps for esbuild)
RUN npm ci --include=dev

# Copy source
COPY src/ ./src/

# Bundle with esbuild (contracts are inlined, no file: dep at runtime)
RUN npm run build

# ─── Production image ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

COPY package*.json ./

# Install only production deps (no contracts needed — already bundled)
RUN npm ci --omit=dev --ignore-scripts 2>/dev/null || npm install --omit=dev --ignore-scripts

# Copy bundled output
COPY --from=builder /app/dist ./dist

EXPOSE 4000

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
