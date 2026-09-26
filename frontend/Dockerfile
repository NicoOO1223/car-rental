# --- deps -------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- builder ------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Nothing stack-specific is baked in: the API address, Stripe publishable key
# and error-tracking address are read from the container's environment when
# it runs (API_URL, STRIPE_PUBLISHABLE_KEY, SENTRY_DSN), so one image serves
# every stack. See lib/runtimeConfig.ts.
RUN npm run build

# --- runner ---------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# output: "standalone" (next.config.ts) traces the minimal set of files
# needed to run the server, so the final image doesn't need node_modules.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# The node image ships an unprivileged "node" user; run as it.
RUN chown -R node:node /app
USER node

EXPOSE 3000

# Next's standalone server binds to the container's own hostname by default,
# which the health check below (and anything else on 127.0.0.1) cannot reach.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:3000/ || exit 1

CMD ["node", "server.js"]
