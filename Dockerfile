FROM node:24-slim
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
EXPOSE 4173
CMD ["node", "server/server.js"]
