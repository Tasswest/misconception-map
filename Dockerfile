FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTED_MODE=1
ENV DATA_DIR=/data
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY package.json package-lock.json next.config.ts ./
COPY scripts ./scripts
COPY db ./db
COPY src/domain ./src/domain
COPY src/server/demo ./src/server/demo
COPY sample-work ./sample-work
COPY fixtures ./fixtures
RUN mkdir -p /data && chmod 700 /data
EXPOSE 3000
CMD ["npm", "start"]
