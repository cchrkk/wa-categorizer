# wa-categorizer — production image
FROM node:22-alpine

# ffmpeg is only needed by the "command" transcription backend (local
# whisper). With the "openai" backend (Groq) you can drop this line and
# save ~80 MB.
RUN apk add --no-cache ffmpeg tini

WORKDIR /app

# Dependencies before the code: as long as package*.json doesn't change,
# this layer stays cached.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src/ ./src/
COPY assets/ ./assets/
COPY config/rules.example.yaml ./config/
COPY config/rules.d/README.md ./config/rules.d/
COPY examples/ ./examples/
COPY fixtures/ ./fixtures/
COPY tools/ ./tools/
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# /app/data is the same folder as DATA_DIR: that way relative paths written
# in the rules ("data/orders.jsonl") land in the volume instead of in the
# image layer, which is lost on every rebuild.
RUN chmod +x /usr/local/bin/entrypoint.sh \
    && mkdir -p /app/data \
    && chown -R node:node /app

# Unprivileged user: nothing here needs root
USER node

ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    AUTH_DIR=/app/data/auth \
    LOG_PRETTY=false

VOLUME ["/app/data"]

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "src/index.js"]
