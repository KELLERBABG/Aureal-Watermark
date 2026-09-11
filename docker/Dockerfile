# Production Air-Gapped Microservice for Aureal Watermark
FROM node:22-alpine

# Install FFmpeg for universal audio transcoding (MP3, FLAC, AAC, OGG)
RUN apk add --no-cache ffmpeg

# Set non-root working environment
WORKDIR /app

# Copy application manifest and engine source files
COPY package.json ./
COPY src/ ./src/
COPY types/ ./types/
COPY bin/ ./bin/
COPY docker/ ./docker/

# Set ownership to unprivileged built-in node user
RUN chown -R node:node /app

# Switch to unprivileged user (air-gapped container security standard)
USER node

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    MAX_BODY_SIZE_MB=100

EXPOSE 8080

# Native Node.js healthcheck probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e 'require("node:http").get("http://127.0.0.1:8080/v1/health", (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }).on("error", () => process.exit(1));'

CMD ["node", "docker/server.js"]
