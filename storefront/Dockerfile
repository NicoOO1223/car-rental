# Built from the REPOSITORY ROOT (the app imports ../shared):
#   docker build -f storefront/Dockerfile .

FROM node:20-alpine AS deps
WORKDIR /repo/storefront
COPY storefront/package.json storefront/package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /repo
COPY --from=deps /repo/storefront/node_modules ./storefront/node_modules
COPY shared ./shared
COPY storefront ./storefront
WORKDIR /repo/storefront
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# The build root is the repo, so the standalone server sits under storefront/.
COPY --from=builder /repo/storefront/.next/standalone ./
COPY --from=builder /repo/storefront/.next/static ./storefront/.next/static
RUN chown -R node:node /app
USER node
EXPOSE 3000
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:3000/health || exit 1
CMD ["node", "storefront/server.js"]
