# Reporting

**Responsibility:** Execution Tracker and report outputs (HTML, JSON, Sheet execution report, evidence).

The original Google Sheet (manual test cases) is never overwritten.

## Implementations

| Type | Class | Output |
|---|---|---|
| Tracker | `InMemoryExecutionTracker` | In-process records keyed by manual test ID |
| Reporter | `JsonFileReporter` | `test-results/execution-report.json` |
| Reporter | `SheetAppendReporter` | Append-only CSV + optional Google Sheet **execution** tab |
| Reporter | `CompositeReporter` | Publishes to multiple reporters |

```ts
const tracker = new InMemoryExecutionTracker();
await tracker.start('CSF-001', 'chromium');
// ... run test ...
await tracker.finish('CSF-001', 'passed');
await createDefaultExecutionReporters().publish(await tracker.list());
```

## Sheet append (append-only)

Config: `config/reporting/sheet-execution.json`

| Sink | When |
|---|---|
| Local CSV (`test-results/sheet-execution-append.csv`) | Always |
| Google Sheets execution tab | When `SGAP_SHEETS_SPREADSHEET_ID` **and** `SGAP_SHEETS_ACCESS_TOKEN` are set |

Guardrails:

- Writes only to `executionTabName` (default: `Execution Report`).
- Refuses if that name equals `manualTabName` (default: `Manual Test Cases`).
- Uses `INSERT_ROWS` append — never clears or overwrites the manual sheet.
