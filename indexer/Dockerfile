FROM node:20-alpine AS build
WORKDIR /app/indexer

COPY indexer/package*.json ./
COPY indexer/prisma ./prisma

RUN npm install --legacy-peer-deps

COPY indexer/ ./
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app/indexer

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/indexer/package*.json ./
COPY --from=build /app/indexer/node_modules ./node_modules
COPY --from=build /app/indexer/dist ./dist
COPY --from=build /app/indexer/prisma ./prisma

EXPOSE 3000

CMD ["node", "dist/index.js"]