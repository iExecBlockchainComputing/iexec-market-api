FROM node:26.13.0-alpine3.24 AS builder

RUN apk update && apk upgrade

RUN mkdir -p /build
WORKDIR /build

COPY package.json .
COPY package-lock.json .
COPY generateEsModulesFromJson.cjs .

RUN npm ci

COPY src ./src
RUN npm run codegen

FROM node:26.13.0-alpine3.24 AS deps

RUN apk update && apk upgrade

RUN mkdir -p /deps
WORKDIR /deps

COPY package.json .
COPY package-lock.json .

RUN npm ci --omit=dev

# Runtime image without npm, following
# https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md#smaller-images-without-npmyarn
# Keep this Alpine version aligned with the node images above (node:*-alpineX.Y):
# the node binary and the node_modules (including native addons) are copied from them.
FROM alpine:3.24.3

RUN apk update && apk upgrade

RUN apk add --no-cache libstdc++ libatomic dumb-init \
  && addgroup -g 1000 node \
  && adduser -u 1000 -G node -s /bin/sh -D node

COPY --from=deps /usr/local/bin/node /usr/local/bin/

RUN mkdir -p /app
WORKDIR /app

COPY package.json .
COPY --from=deps /deps/node_modules ./node_modules
COPY --from=builder /build/src ./src

USER node

# dumb-init runs as PID 1 and forwards signals to node
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "--require", "dotenv/config", "src/index.js"]
