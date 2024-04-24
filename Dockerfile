FROM node:21-alpine3.18
WORKDIR /usr/src/app
COPY package*.json ./
RUN apk --no-cache add curl
RUN npm install
RUN npm i -g typescript ts-node
RUN npm prune --production
COPY . .
EXPOSE 8080
ENV ENV_RUN_AS "docker"
HEALTHCHECK --interval=1s --timeout=10s --retries=2 \
  CMD curl -m 10 -f http://localhost:8080/health  || kill 1 
ENTRYPOINT [ "ts-node" , "src/index.ts"] 