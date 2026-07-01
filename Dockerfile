FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN npm run build

FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm ci --omit=dev \
  && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY scripts ./scripts

EXPOSE 3000

CMD ["node", "dist/main.js"]
