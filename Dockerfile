FROM node:22.14-bookworm-slim AS builder

WORKDIR /app
ENV NODE_ENV=production \
    NODE_OPTIONS=--no-warnings

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

FROM node:22.14-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/memecast.sqlite \
    MEDIA_ROOT=/data/media \
    NODE_OPTIONS=--no-warnings

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY server.mjs ./server.mjs
RUN mkdir -p /data/media && chown -R node:node /app /data

USER node
EXPOSE 3000

HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["npm", "run", "start"]
