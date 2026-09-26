FROM node:20-alpine

# Install openssl for Prisma engine support on Alpine
RUN apk add --no-cache openssl

WORKDIR /app

# Copy package manifests
COPY package.json package-lock.json ./

# Install production and build dependencies
RUN npm ci

# Copy Prisma schema and source code required for generation and build
COPY prisma ./prisma
COPY tsconfig.json ./
COPY src ./src

# Generate Prisma client
RUN npx prisma generate

# Build TypeScript source
RUN npm run build

# Expose default HTTP port
EXPOSE 3000

# Default port environment variable
ENV PORT=3000

# Start compiled server
CMD ["npm", "start"]
