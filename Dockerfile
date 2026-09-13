# syntax=docker/dockerfile:1

# --- Builder stage -----------------------------------------------------
# Installs full (dev+prod) dependencies and compiles TypeScript -> dist/.
# No Gemini/Qdrant credentials are needed here: `nest build` only runs
# tsc-level compilation and never constructs the Gemini/Qdrant clients
# (both are built lazily, on first real use, not at import/boot time).
FROM node:24.21.0-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src

RUN npm run build

# --- Runtime stage -------------------------------------------------------
# Only production dependencies + compiled output. No source, no tests,
# no dev tooling, no .env, no PDFs (the running API never reads them).
FROM node:24.21.0-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Documents the default; the actual bound port is controlled by $PORT at
# runtime (see main.ts: `app.listen(process.env.PORT ?? 3000)`), and Node's
# `listen(port)` with no host binds all interfaces by default.
EXPOSE 3000

CMD ["node", "dist/main.js"]
