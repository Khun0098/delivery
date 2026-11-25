# API (Node >= 22.5, sem dependências externas). Os sites estáticos ficam no nginx/CDN (veja deploy/nginx.conf).
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY apps/api ./apps/api
COPY scripts ./scripts
ENV NODE_ENV=production API_PORT=4000 DB_PATH=/data/delivery.db UPLOAD_DIR=/data/uploads
VOLUME /data
EXPOSE 4000
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "apps/api/server.js"]
