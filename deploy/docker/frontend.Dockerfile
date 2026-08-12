# Attendance frontend — multi-stage: build React SPA, serve via nginx.
# The nginx container also proxies /api and /admin to the backend container.

# ---- Stage 1: build the React SPA ----
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# VITE_API_BASE empty => same-origin; nginx proxies /api to the backend.
ARG VITE_API_BASE=""
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

# ---- Stage 2: nginx ----
FROM nginx:1.27-alpine
# Default nginx needs an ssl-cert when TLS certs are referenced; we use a
# template that tolerates their absence (see nginx.conf.template).
COPY deploy/docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
