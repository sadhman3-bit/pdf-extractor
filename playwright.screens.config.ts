import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/** Runs only the screenshot capture (see apps/web/e2e/screenshots.spec.ts). */
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: '**/screenshots.spec.ts',
});
