# CareCircle MCP server — deployable image.
# Multi-stage: build with dev deps, ship only what runs.
FROM public.ecr.aws/docker/library/node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
# Build the React (Vite) sim UI as a separate workspace.
COPY sim-ui ./sim-ui
RUN cd sim-ui && npm ci && npm run build

FROM public.ecr.aws/docker/library/node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/sim-ui/dist ./sim-ui/dist
COPY public ./public
# AgentCore expects 0.0.0.0:8000/mcp; App Runner health-checks the same port.
ENV PORT=8000
EXPOSE 8000
# Persistence and identity are chosen by env at runtime:
#   CARECIRCLE_TABLE     -> DynamoDB (else in-container file, ephemeral)
#   CARECIRCLE_JWT_CLAIM -> JWT identity (else static demo tokens)
#   CARECIRCLE_SNS_TOPIC -> real notify delivery
CMD ["node", "dist/http.js"]
