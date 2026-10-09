FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY server.js ./server.js
COPY customer-api-mapping.example.json ./customer-api-mapping.example.json
COPY public ./public
EXPOSE 3000
USER node
CMD ["node", "server.js"]
