# FounderOS — single image that serves the API and the built frontend.
#
#   docker compose up --build        # with the bundled Postgres
#   docker build -t founderos .      # image only
#
# Debian (glibc) base: the workspace excludes musl builds of esbuild/rollup/
# lightningcss/tailwind-oxide, so Alpine would fail to install.
FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate

WORKDIR /app

# Install first so dependency layers cache independently of source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json tsconfig.json ./
COPY artifacts/api-server/package.json artifacts/api-server/
COPY artifacts/founder-os/package.json artifacts/founder-os/
COPY lib/db/package.json lib/db/
COPY lib/api-spec/package.json lib/api-spec/
COPY lib/api-zod/package.json lib/api-zod/
COPY lib/api-client-react/package.json lib/api-client-react/
COPY scripts/package.json scripts/
RUN pnpm install --frozen-lockfile

COPY artifacts ./artifacts
COPY lib ./lib
COPY scripts ./scripts
COPY docker ./docker

# The Vite config insists on these at build time; they only affect the bundle's base path.
ENV PORT=5000
ENV BASE_PATH=/
ENV NODE_ENV=production
RUN pnpm run build

ENV SERVE_STATIC_DIR=/app/artifacts/founder-os/dist/public
EXPOSE 5000

ENTRYPOINT ["sh", "/app/docker/entrypoint.sh"]
