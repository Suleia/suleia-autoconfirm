FROM node:22.22.0-bookworm-slim

WORKDIR /app

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV DISCOUNT_BROWSER_EXECUTABLE=/usr/local/bin/suleia-chromium

COPY package.json pnpm-lock.yaml ./
RUN corepack enable \
    && corepack prepare pnpm@10.12.1 --activate \
    && pnpm install --prod --frozen-lockfile --ignore-scripts \
    && node node_modules/playwright-core/cli.js install --with-deps chromium \
    && node --input-type=module -e "import { chromium } from 'playwright-core'; import { symlinkSync } from 'node:fs'; symlinkSync(chromium.executablePath(), '/usr/local/bin/suleia-chromium'); const browser = await chromium.launch({headless:true}); const page = await browser.newPage(); await page.setContent('<title>Capture runtime ready</title>'); if (await page.title() !== 'Capture runtime ready') process.exitCode=1; await browser.close();"
COPY src ./src
COPY tools ./tools
COPY dashboard ./dashboard
COPY server.mjs ./
COPY data ./data

EXPOSE 8787

CMD ["node", "server.mjs"]
