import { defineConfig } from 'playwright/test';
import fs from 'node:fs';

const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const linuxChrome = '/usr/bin/google-chrome';
const linuxChromium = '/usr/bin/chromium';

const executablePath = fs.existsSync(macChrome)
  ? macChrome
  : fs.existsSync(linuxChrome)
    ? linuxChrome
    : fs.existsSync(linuxChromium)
      ? linuxChromium
      : undefined;

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  webServer: {
    command: './node_modules/.bin/vite --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    launchOptions: {
      executablePath,
    },
  },
});
