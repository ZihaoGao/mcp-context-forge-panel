FROM node:24-alpine AS build
ARG http_proxy
ARG https_proxy
ARG no_proxy
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY contracts ./contracts
COPY scripts ./scripts
RUN npm run build

FROM node:24-alpine AS runtime
ARG http_proxy
ARG https_proxy
ARG no_proxy
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && rm -rf .cache
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node apps/server ./apps/server
COPY --chown=node:node LICENSE THIRD_PARTY_NOTICES.md ./
COPY --chown=node:node licenses ./licenses
USER node
EXPOSE 3000
CMD ["node", "apps/server/index.mjs"]
