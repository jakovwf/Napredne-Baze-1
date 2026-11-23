# build context je koren repoa (npm workspaces + packages/shared)
# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY packages/shared/package.json packages/shared/
RUN npm ci
COPY packages/shared packages/shared
COPY apps/frontend apps/frontend
RUN npm run build -w @pixelboard/shared && npm run build -w frontend -- --configuration production

# ---- serviranje ----
FROM nginx:1.27-alpine
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
# putanja dist/frontend/browser prati ime projekta "frontend" u angular.json
COPY --from=build /app/apps/frontend/dist/frontend/browser /usr/share/nginx/html
EXPOSE 80
