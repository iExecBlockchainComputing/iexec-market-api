FROM node:22.14-alpine3.21

RUN mkdir -p /app
WORKDIR /app

RUN apk update && apk upgrade

COPY package.json .
COPY package-lock.json .
COPY generateEsModulesFromJson.cjs .
COPY updateVersionOpenApi.cjs .
COPY openapi.yaml .

RUN npm ci --omit=dev

COPY src ./src

CMD ["npm", "start"]
