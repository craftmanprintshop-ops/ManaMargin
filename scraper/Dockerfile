FROM node:20-bookworm

WORKDIR /app

# Install dependencies first (better docker layer cache)
COPY package.json ./
RUN npm install --omit=dev

# Install Playwright + Chromium + system deps
RUN npx playwright install --with-deps chromium

COPY server.js ebay-scrape-worker.js ./

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000
CMD ["node", "server.js"]
