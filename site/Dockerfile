# Production image for Coolify: SvelteKit (adapter-node) on plain Node.
# Coolify builds this on wicker-01; don't build it on the Mac.
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm install -g pnpm@10.28.2
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# All configuration is read at runtime, so the build needs no secrets.
RUN pnpm build && pnpm prune --prod

FROM node:24-slim AS runtime
# Behind Traefik: the public origin comes from the forwarded headers, so both
# enso.wicker.life and enso.c.wicker.life work. BODY_SIZE_LIMIT allows release
# uploads; each route enforces its own smaller limit.
ENV NODE_ENV=production \
    PORT=3000 \
    PROTOCOL_HEADER=x-forwarded-proto \
    HOST_HEADER=x-forwarded-host \
    ADDRESS_HEADER=x-forwarded-for \
    XFF_DEPTH=1 \
    BODY_SIZE_LIMIT=210M
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/migrations ./migrations
COPY --from=build --chown=node:node /app/scripts ./scripts
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "scripts/start.sh"]
