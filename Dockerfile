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
  && rm -rf /var/lib/apt/lists/* \
  && npm ci --omit=dev \
  && npm rebuild sharp \
  && node -e "require('sharp')({create:{width:8,height:8,channels:3,background:'#f00'}}).webp().toBuffer().then((b)=>{if(!b?.length)throw new Error('empty');console.log('sharp build OK',b.length)})" \
  && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY scripts ./scripts

EXPOSE 3000

CMD ["node", "dist/main.js"]
