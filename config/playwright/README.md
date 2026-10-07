# Playwright configuration notes

Global Playwright settings live in `playwright.config.ts` at the repository root.

This folder holds optional Playwright-related configuration fragments (environment overrides, reporter options) as the project grows.

Browser projects configured at bootstrap:

- `chrome` — Google Chrome (`channel: 'chrome'`)
- `edge` — Microsoft Edge (`channel: 'msedge'`)
