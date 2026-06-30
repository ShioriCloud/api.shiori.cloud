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
    libvips42 \
    libglib2.0-0 \
    libexpat1 \
    libstdc++6 \
  && rm -rf /var/lib/apt/lists/* \
  && npm ci --omit=dev \
  && npm install --no-save @img/sharp-linux-x64@0.35.2 @img/sharp-libvips-linux-x64@1.3.1 \
  && rm -rf node_modules/@img/sharp-linuxmusl-x64 node_modules/@img/sharp-libvips-linuxmusl-x64 node_modules/@img/sharp-wasm32 \
  && node -e "require('sharp')({create:{width:8,height:8,channels:3,background:'#f00'}}).webp().toBuffer().then((b)=>{if(!b?.length)throw new Error('empty');console.log('sharp build OK',b.length)})" \
  && npm cache clean --force

ENV LD_LIBRARY_PATH=/app/node_modules/@img/sharp-libvips-linux-x64/lib

COPY --from=builder /app/dist ./dist
COPY scripts ./scripts

EXPOSE 3000

CMD ["node", "dist/main.js"]
