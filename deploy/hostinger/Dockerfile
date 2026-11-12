FROM node:22-bookworm-slim
ENV NODE_ENV=production BIND_HOST=0.0.0.0 PORT=3000
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node server/http-server.cjs ./server/http-server.cjs
COPY --chown=node:node server/api/ ./server/api/
COPY --chown=node:node server/providers/ ./server/providers/
COPY --chown=node:node server/services/ ./server/services/
COPY --chown=node:node web/ ./web/
RUN mkdir -p /app/server/.cache && chown -R node:node /app/server/.cache
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>{if(!r.ok)process.exitCode=1}).catch(()=>{process.exitCode=1})"
CMD ["node", "server/http-server.cjs"]
