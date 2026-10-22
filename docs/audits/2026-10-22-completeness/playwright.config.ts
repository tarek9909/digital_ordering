import {defineConfig,devices} from '../../../frontend/node_modules/@playwright/test';
export default defineConfig({testDir:'.',testMatch:['browser-journeys.spec.ts','browser-recovery.spec.ts'],timeout:60_000,expect:{timeout:10_000},workers:1,fullyParallel:false,retries:0,reporter:[['list'],['json',{outputFile:'browser-journey-results.json'}]],outputDir:'browser-test-output',use:{locale:'en-US',trace:'off'},projects:[{name:'chromium',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['Pixel 7']}}]});

