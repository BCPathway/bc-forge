FROM node:20-alpine

# openssl is required by the Prisma query engine on Alpine.
RUN apk add --no-cache openssl

# Build from the repository root. @bc-forge/indexer depends on the
# @bc-forge/sdk workspace, which is not published, so an indexer-only
# context cannot npm ci.
WORKDIR /app

COPY package.json package-lock.json ./
COPY sdk/package.json ./sdk/package.json
COPY cli/package.json ./cli/package.json
COPY react/package.json ./react/package.json
COPY indexer/package.json ./indexer/package.json

RUN npm ci --workspace @bc-forge/indexer --include-workspace-root

COPY sdk ./sdk
COPY indexer/prisma ./indexer/prisma
COPY indexer/tsconfig.json ./indexer/tsconfig.json
COPY indexer/src ./indexer/src
COPY indexer/scripts ./indexer/scripts

WORKDIR /app/indexer

RUN npx prisma generate
RUN npm run build

EXPOSE 3000
ENV PORT=3000
CMD ["npm", "start"]
