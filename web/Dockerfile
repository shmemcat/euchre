# syntax=docker/dockerfile:1
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=secret,id=fontawesome_token,env=FONTAWESOME_PACKAGE_TOKEN,required=true \
    npm ci --no-audit --no-fund
COPY . .
ARG VITE_BASE_PATH=/
ARG VITE_ACCOUNT_API_URL=
ENV VITE_BASE_PATH=$VITE_BASE_PATH
ENV VITE_ACCOUNT_API_URL=$VITE_ACCOUNT_API_URL
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3002
HEALTHCHECK --interval=15s --timeout=3s CMD wget -q --spider http://127.0.0.1:3002/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
