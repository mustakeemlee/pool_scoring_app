# Build context MUST be the repo root (see docker-compose.yml's frontend
# service: `context: .`) -- web/src/components/OddsWidget.tsx imports
# directly from ../../../src/rating/odds, reaching outside web/ into the
# Phase 1 rating engine.
FROM node:20.20.2-alpine3.23 AS build
WORKDIR /app
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY src/rating ./src/rating
COPY web ./web
# Build-time only -- these get compiled into the static JS bundle the same
# way any public client-side config would be, not injected at runtime. This
# is not a secret: the anon key is designed to be safe for a public client
# to hold (RLS is what actually protects data, not key secrecy).
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN cd web && npx tsc -b && npx vite build

FROM nginx:1.31.3-alpine
COPY --from=build /app/web/dist /usr/share/nginx/html
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
