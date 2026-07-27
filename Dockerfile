FROM node:18-bullseye-slim

# Install Chromium and extra fonts for better rendering
RUN apt-get update \
 && apt-get install -y \
    chromium \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    --no-install-recommends \
 && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer where to find the browser
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create a non‑root user for running the browser
RUN groupadd -r pptruser \
 && useradd -r -g pptruser -G audio,video pptruser \
 && mkdir -p /home/pptruser/Downloads \
 && chown -R pptruser:pptruser /home/pptruser

WORKDIR /app

# Copy package files and install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the rest of the app
COPY assets/ ./assets/
COPY views/ ./views/
COPY app.js ./

RUN chown -R pptruser:pptruser /app
USER pptruser

# Your custom environment variables (to be supplied at runtime)
ENV PORT=3000
ENV MEALIE_URL="" \
    MEALIE_TOKEN="" \
    CACHE_TTL=""

EXPOSE ${PORT}
CMD ["node", "app.js"]