import { defineConfig } from '@playwright/test';
try { process.loadEnvFile('.env'); } catch { /* CI can inject its environment */ }
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 240000,
  expect: {timeout: 10000}, retries: 0,
  reporter: [['list'], ['html',{outputFolder:'.local/reports/playwright',open:'never'}], ['json',{outputFile:'.local/reports/playwright.json'}]],
  use: { baseURL: `http://127.0.0.1:${process.env.LOCAL_PORT||18088}`, browserName:'chromium', channel:process.env.E2E_BROWSER_CHANNEL, viewport:{width:1440,height:900}, actionTimeout:10000, navigationTimeout:15000, screenshot:'only-on-failure', trace:'retain-on-failure' },
  outputDir: '.local/reports/test-results'
});
