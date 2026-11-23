# syntax=docker/dockerfile:1
# The API image. Build from the repo root:  docker build -f apps/api/Dockerfile -t wp-api .
# Built and pushed only by .github/workflows/deploy.yml.
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @wm/api... --ignore-scripts
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @wm/shared build && pnpm --filter @wm/api build \
 && pnpm --filter @wm/api deploy --prod --legacy /out

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
# RDS certificates are signed by Amazon's RDS authority, which Node does not trust by default.
# The API checks the database certificate (rejectUnauthorized), so add AWS's published bundle.
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/rds-ca.pem
ENV NODE_EXTRA_CA_CERTS=/app/rds-ca.pem
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
