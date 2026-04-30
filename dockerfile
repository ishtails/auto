# syntax=docker/dockerfile:1.20
# Stage 1: Build
FROM oven/bun:1.3.12 AS builder
WORKDIR /app

# Caching bun install dependencies
COPY package.json bun.lock ./
COPY --parents apps/*/package.json packages/*/package.json /app/

RUN --mount=type=cache,target=/root/.bun/install/cache \
	bun install

COPY . .

RUN bun run server:compile

# Stage 2: Compile and run
FROM debian:bookworm-slim AS release
WORKDIR /app

COPY --from=builder /app/apps/server/out/server .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["./server"]
