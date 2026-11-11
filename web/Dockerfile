# Builds the React app and serves it with Caddy, which also proxies /api to the Go API.
FROM node:24-alpine AS build
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
COPY api/ ../api/
ARG VITE_GOOGLE_CLIENT_ID=""
ENV VITE_API_BASE_URL=/api VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN npx vite build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/web/dist /srv
