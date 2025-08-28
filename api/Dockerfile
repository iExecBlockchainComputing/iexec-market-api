FROM node:22.14-alpine3.21

RUN mkdir -p /app
WORKDIR /app

RUN apk update && apk upgrade

COPY package.json .
COPY package-lock.json .
COPY generateEsModulesFromJson.cjs .
RUN npm ci --omit=dev

COPY src ./src
COPY openapi.yaml .

CMD ["npm", "start"]
