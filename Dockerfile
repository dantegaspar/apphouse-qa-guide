# syntax=docker/dockerfile:1

# ---- deps: instala dependencias (incluye devDependencies para el build) ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Herramientas de compilación por si better-sqlite3 necesita compilarse (no hay binario precompilado).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compila la app de Next.js ----
FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build

# ---- runner: imagen final mínima, sin devDependencies, como usuario no root ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATA_DIR=/app/data \
    UPLOAD_DIR=/app/uploads \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Salida standalone (server.js + node_modules trazados)
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

# Por seguridad, asegura el módulo nativo better-sqlite3 y sus dependencias en node_modules.
COPY --from=deps /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=deps /app/node_modules/bindings ./node_modules/bindings
COPY --from=deps /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

# Directorios de datos y subidas, propiedad del usuario node
RUN mkdir -p /app/data /app/uploads \
 && chown -R node:node /app/data /app/uploads

USER node

VOLUME ["/app/data", "/app/uploads"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
