# Use the official, pre‑built Puppeteer image
FROM ghcr.io/puppeteer/puppeteer:latest

# Switch to root temporarily to set up the app directory
USER root

WORKDIR /app

# Copy package files and install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev \
 && npm cache clean --force

# Copy the rest of your application
COPY views/ ./views/
COPY app.js ./

# Make sure the non‑root user owns the app directory
RUN chown -R pptruser:pptruser /app

# Switch back to the unprivileged user provided by the base image
USER pptruser

# The base image already sets PUPPETEER_EXECUTABLE_PATH, but we’ll keep the env
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Default port (can be overridden at runtime)
ENV PORT=3000

# Your app needs these to function – provide them at runtime
# MEALIE_URL, MEALIE_TOKEN, CACHE_TTL are not set here, only documented
ENV MEALIE_URL="" \
    MEALIE_TOKEN="" \
    CACHE_TTL="3600"

EXPOSE ${PORT}

CMD ["node", "app.js"]