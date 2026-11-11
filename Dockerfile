FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:26-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js ./

USER node

EXPOSE 3000

CMD ["node", "server.js"]
