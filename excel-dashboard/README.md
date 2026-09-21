# Excel Dashboard (standalone)

Upload **three** Excel/CSV files in the browser and get a live business dashboard.

Independent of Delivery Hub and Master Page. No server upload — parsing stays in the browser.

## Files

```
excel-dashboard.html          ← shortcut
excel-dashboard/
├── index.html
├── styles.css
└── script.js
```

## How to use

1. Open `excel-dashboard/index.html` via any static HTTP server (or `/excel-dashboard.html`).
2. Choose / drop File 1, File 2, and File 3 (`.xlsx`, `.xls`, or `.csv`).
3. Click **Analyze files**.

| Slot | Section |
|------|---------|
| File 1 | Main dashboard — KPIs, 2 charts, search + column filter + sortable table |
| File 2 | Second section — KPIs, chart, searchable sortable table |
| File 3 | Third section — KPIs, chart, searchable sortable table |

A **Relationships** panel detects shared column names and overlapping values across files.

## Libraries (CDN)

- [SheetJS (xlsx 0.18.5)](https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js) — parse Excel/CSV
- [Chart.js 4.4.1](https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js) — charts

## Note

There were no Excel files in the repo when this was built, so the page is an upload-driven analyzer. After you pick three files, every KPI, chart, and table cell comes only from those files (no mock data).
