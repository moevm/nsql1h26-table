FROM node:20.18.1-alpine3.20

WORKDIR /app

COPY . .

ENV NODE_ENV=production
ENV APP_PORT=8080

EXPOSE 8080

CMD ["node", "src/server.js"]
