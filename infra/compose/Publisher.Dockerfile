FROM node:24.10.0-bookworm-slim@sha256:b8d2197aff9129d16c801a3e3e1b2a873c4946480f5a310f38056df2268c38d9
RUN npm install --global pnpm@11.19.0
ARG APP_UID=1000
ARG APP_GID=1000
WORKDIR /app
ENV HOME=/home/publisher
RUN mkdir -p "$HOME" && chown ${APP_UID}:${APP_GID} /app "$HOME"
COPY --chown=${APP_UID}:${APP_GID} . .
USER ${APP_UID}:${APP_GID}
RUN pnpm install --frozen-lockfile
ENV NODE_ENV=production
CMD ["node", "apps/publisher/src/worker.mjs"]
