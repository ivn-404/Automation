/**
 * Generate + open Allure history index for the latest run.
 */
import { publishAllureReport } from './generate-allure-report.mjs';

const result = await publishAllureReport();
process.exit(result.ok ? 0 : 1);
