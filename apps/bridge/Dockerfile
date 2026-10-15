FROM alpine:3.24 AS build
RUN apk upgrade --no-cache \
    && apk add --no-cache nodejs=24.18.1-r0 npm=11.12.1-r0 ca-certificates
WORKDIR /repo
COPY package.json package-lock.json tsconfig.json ./
COPY apps/bridge/package.json ./apps/bridge/package.json
COPY packages/bridge-core/package.json packages/bridge-core/tsconfig.build.json ./packages/bridge-core/
COPY packages/bridge-core/src ./packages/bridge-core/src
RUN npm ci --include-workspace-root --workspace @panodash/bridge-core
RUN npm run build --workspace @panodash/bridge-core

FROM alpine:3.24
RUN apk upgrade --no-cache \
    && apk add --no-cache nodejs=24.18.1-r0 ca-certificates \
    && addgroup -g 1000 node \
    && adduser -u 1000 -G node -s /bin/sh -D node
WORKDIR /app
COPY apps/bridge/src ./apps/bridge/src
COPY packages/bridge-core/package.json ./node_modules/@panodash/bridge-core/package.json
COPY --from=build /repo/packages/bridge-core/dist ./node_modules/@panodash/bridge-core/dist
ENV PORT=8787
EXPOSE 8787
USER node
CMD ["node", "apps/bridge/src/server.ts"]
