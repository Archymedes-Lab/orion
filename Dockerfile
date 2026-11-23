# One image: the exported web app and the API that serves it.
# Metro (the Expo bundler) needs Node; Bun installs the packages and runs the scripts.
FROM node:22-slim AS build
COPY --from=oven/bun:1.3 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ENV EXPO_NO_TELEMETRY=1 CI=1
RUN bun run build:web

FROM oven/bun:1.3-slim
WORKDIR /app
ENV NODE_ENV=production ORION_SERVE=1 ORION_HOST=0.0.0.0 PORT=3001 ORION_STATIC_DIR=dist
# The server only imports zod; the app's own dependencies are already compiled into dist/.
COPY --from=build /app/node_modules/zod node_modules/zod
COPY --from=build /app/package.json ./
COPY --from=build /app/server server
COPY --from=build /app/src src
COPY --from=build /app/dist dist
USER bun
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "server/index.ts"]
