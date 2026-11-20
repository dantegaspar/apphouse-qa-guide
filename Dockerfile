# syntax=docker/dockerfile:1

# ---- deps: instala dependencias (incluye devDependencies para el build) ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# better-sqlite3 trae binarios precompilados (prebuilds) para linux x64/arm64.
# --ignore-scripts evita que npm intente compilarlo con node-gyp (la imagen slim no
# tiene python ni compilador); ninguna otra dependencia necesita scripts de instalación.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

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

# Asegura el módulo nativo de better-sqlite3 (binario compilado para esta imagen).
COPY --from=deps /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3

# Directorios de datos y subidas, propiedad del usuario node
RUN mkdir -p /app/data /app/uploads \
 && chown -R node:node /app/data /app/uploads

USER node

# Sin instrucción VOLUME: Railway no la admite. Los volúmenes se declaran en docker-compose.yml
# (local) o en el panel de Railway (un solo volumen en /app/data).
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
