FROM node:22-bookworm-slim
ENV NODE_ENV=production BIND_HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --chown=node:node server/http-server.cjs ./server/http-server.cjs
COPY --chown=node:node webos/fidelity/api ./webos/fidelity/api
COPY --chown=node:node webos/fidelity/assets ./webos/fidelity/assets
COPY --chown=node:node webos/fidelity/images ./webos/fidelity/images
COPY --chown=node:node webos/fidelity/js ./webos/fidelity/js
COPY --chown=node:node webos/fidelity/css ./webos/fidelity/css
COPY --chown=node:node webos/fidelity/index.html ./webos/fidelity/index.html
COPY --chown=node:node webos/fidelity/config/api.js ./webos/fidelity/config/api.js
COPY --chown=node:node webos/fidelity/data/portal.js ./webos/fidelity/data/portal.js
COPY --chown=node:node tools/check-portal.cjs ./tools/check-portal.cjs
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>{if(!r.ok)process.exitCode=1}).catch(()=>{process.exitCode=1})"
CMD ["node", "server/http-server.cjs"]
