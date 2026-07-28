const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
  testDir: './modules',
  testMatch: ['**/*.spec.js'],
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 40_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [
    ['dot'],
    ['html', { outputFolder: 'reporter/html', open: 'never' }]
  ],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 40_000
  }
})
