FROM node:14.6-alpine

RUN mkdir -p /app
WORKDIR /app

RUN apk update && apk upgrade

COPY package.json package.json
RUN npm install --production

COPY ./src ./src

CMD ["npm", "start"]
