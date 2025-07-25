# Multi-stage build for HealthAI Assistant
FROM node:18-alpine AS base

# Install Python and build dependencies
RUN apk add --no-cache python3 py3-pip python3-dev build-base

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY requirements.txt ./

# Install dependencies
RUN npm ci --only=production
RUN pip3 install -r requirements.txt --break-system-packages

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:18-alpine AS production

RUN apk add --no-cache python3 py3-pip

WORKDIR /app

# Copy built application and dependencies
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/dist ./dist
COPY --from=base /app/client/dist ./client/dist
COPY --from=base /app/server ./server
COPY --from=base /app/shared ./shared
COPY --from=base /app/package*.json ./
COPY --from=base /usr/lib/python3.11/site-packages /usr/lib/python3.11/site-packages

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S healthai -u 1001

# Set ownership
RUN chown -R healthai:nodejs /app
USER healthai

EXPOSE 5000

ENV NODE_ENV=production
ENV PORT=5000

CMD ["node", "dist/server/index.js"]