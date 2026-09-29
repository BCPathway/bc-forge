FROM node:20-alpine

# Install openssl for Prisma engine support on Alpine
RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json ./
COPY cli/package.json cli/package.json
COPY indexer/package.json indexer/package.json
COPY react/package.json react/package.json
COPY sdk/package.json sdk/package.json
COPY sdk/tsconfig.json sdk/tsconfig.json
COPY sdk/src sdk/src
COPY indexer/tsconfig.json indexer/tsconfig.json
COPY indexer/prisma indexer/prisma
COPY indexer/src indexer/src

RUN npm ci --workspace=sdk --workspace=indexer --include-workspace-root=false
RUN npm run build --workspace=sdk
RUN npm run prisma:generate --workspace=indexer
RUN npm run build --workspace=indexer

WORKDIR /app/indexer

EXPOSE 3000

ENV PORT=3000

CMD ["npm", "start"]
