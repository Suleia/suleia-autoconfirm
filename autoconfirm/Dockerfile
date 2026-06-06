FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY tools ./tools
COPY dashboard ./dashboard
COPY server.mjs ./
COPY data ./data

EXPOSE 8787

CMD ["node", "server.mjs"]
