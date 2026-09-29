
FROM node:26.8.2-alpine3.24 AS builder

RUN apk update && apk upgrade

RUN mkdir -p /build
WORKDIR /build

COPY package.json .
COPY package-lock.json .
COPY generateEsModulesFromJson.cjs .
COPY updateVersionOpenApi.cjs .
COPY openapi.yaml .

RUN npm ci
RUN npm run codegen

FROM node:26.8.2-alpine3.24

RUN apk update && apk upgrade

RUN mkdir -p /app
WORKDIR /app

COPY package.json .
COPY package-lock.json .

RUN npm ci --omit=dev

COPY --from=builder /build/src ./src
COPY --from=builder /build/openapi.yaml .

CMD ["npm", "start"]
