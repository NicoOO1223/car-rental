# Node 22: the Azure email SDK the form sends mail with declares 22 as its minimum.
# Built from the REPOSITORY ROOT (the app imports ../shared):
#   docker build -f marketing/Dockerfile -t marketing .
#
# SITE_URL and SITE_INDEXABLE are read when the site is built (canonical addresses,
# robots.txt and the noindex tag are baked into the pages), so a deployment that is
# meant to be found by search engines is built with both. The site stays noindex
# regardless while content/brand.ts is a placeholder.
#   docker build -f marketing/Dockerfile --build-arg SITE_URL=https://example.com --build-arg SITE_INDEXABLE=true .

FROM node:22-alpine AS deps
WORKDIR /repo/marketing
COPY marketing/package.json marketing/package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /repo
ARG SITE_URL=""
ARG SITE_INDEXABLE=""
ENV SITE_URL=$SITE_URL SITE_INDEXABLE=$SITE_INDEXABLE NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /repo/marketing/node_modules ./marketing/node_modules
COPY shared ./shared
COPY marketing ./marketing
WORKDIR /repo/marketing
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# The build root is the repo, so the standalone server sits under marketing/.
COPY --from=builder /repo/marketing/.next/standalone ./
COPY --from=builder /repo/marketing/.next/static ./marketing/.next/static
# The standalone output does not include public/, which holds the screenshots.
COPY --from=builder /repo/marketing/public ./marketing/public
RUN chown -R node:node /app
USER node
EXPOSE 3000
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:3000/health || exit 1
CMD ["node", "marketing/server.js"]
