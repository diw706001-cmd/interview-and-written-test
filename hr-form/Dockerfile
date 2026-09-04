FROM node:22-alpine

ENV NODE_ENV=production
ENV PORT=3000
ENV HR_AUTH_REQUIRED=true
ENV HR_DATA_FILE=/app/data/state.json
ENV HR_MAX_BODY_BYTES=1048576

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY server.js server-core.js preflight.js index.html ./
COPY scripts ./scripts

RUN mkdir -p /app/data /app/data/uploads \
  && chown -R node:node /app

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
