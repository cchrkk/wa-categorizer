# wa-categorizer — immagine di produzione
FROM node:22-alpine

# ffmpeg serve solo al backend di trascrizione "command" (whisper locale).
# Con il backend "openai" (Groq) si può togliere:  -RUN apk add --no-cache ffmpeg
RUN apk add --no-cache ffmpeg tini

WORKDIR /app

# Le dipendenze prima del codice: finché package*.json non cambia, il layer resta in cache
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src/ ./src/
COPY config/rules.example.yaml ./config/
COPY config/rules.d/README.md ./config/rules.d/
COPY examples/ ./examples/
COPY fixtures/ ./fixtures/
COPY tools/ ./tools/
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# /app/data è la stessa cartella di DATA_DIR: così i percorsi relativi scritti
# nelle regole ("data/ordini.jsonl") finiscono nel volume e non nel layer
# dell'immagine, che si perde a ogni rebuild.
RUN chmod +x /usr/local/bin/entrypoint.sh \
    && mkdir -p /app/data \
    && chown -R node:node /app

# Utente non privilegiato: l'app non ha bisogno di root
USER node

ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    AUTH_DIR=/app/data/auth \
    LOG_PRETTY=false

VOLUME ["/app/data"]

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "src/index.js"]
