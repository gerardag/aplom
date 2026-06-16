FROM node:22-alpine

WORKDIR /app

# Install backend dependencies first (better layer caching).
# Only express is needed — SQLite is Node's built-in node:sqlite, no native build.
COPY backend/package.json ./package.json
RUN npm install --omit=dev

# Backend source
COPY backend/ ./

# Frontend served statically from ./public by server.js
COPY frontend/ ./public/

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data
# node:sqlite is stable enough for personal use; silence the experimental notice
ENV NODE_NO_WARNINGS=1

EXPOSE 3000

RUN mkdir -p /app/data

# node:sqlite still lives behind a flag on Node 22 — without it the import throws.
CMD ["node", "--experimental-sqlite", "server.js"]
