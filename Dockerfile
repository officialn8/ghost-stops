# The live Ghost score worker's image (plan U20, KTD15): one always-on Fly Machine runs it.
#
# Two stages, so tsx, the Prisma CLI, ESLint, vitest, and esbuild never ship beside the secrets:
# the build stage installs everything, generates the Prisma client, and bundles the entry script
# for Node with packages external; the runtime stage installs production dependencies only, with
# scripts ignored, and runs the bundle. The base image is pinned by digest, as CI pins its actions.
ARG NODE_IMAGE=node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392

FROM ${NODE_IMAGE} AS build
WORKDIR /build
ENV NODE_ENV=development
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# postinstall runs `prisma generate`; prisma.config.ts needs no database for it.
RUN npm ci
COPY tsconfig.json tsconfig.scripts.json ./
COPY src ./src
COPY scripts ./scripts
RUN npx esbuild scripts/live-worker.ts \
    --bundle --platform=node --target=node22 --format=esm --packages=external \
    --alias:@=./src --outfile=dist/live-worker.mjs

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV LIVE_WORKER_DATA_DIR=/var/lib/ghost-stops
COPY package.json package-lock.json ./
# @prisma/client names the Prisma CLI and TypeScript as optional peers, which npm keeps under
# --omit=dev; neither runs here, so they go, with the CLI's own dependencies.
RUN npm ci --omit=dev --ignore-scripts \
    && rm -rf node_modules/prisma node_modules/@prisma/dev node_modules/typescript node_modules/valibot \
    && npm cache clean --force
COPY --from=build /build/dist ./dist
RUN mkdir -p /var/lib/ghost-stops && chown node:node /var/lib/ghost-stops
USER node
CMD ["node", "dist/live-worker.mjs"]
