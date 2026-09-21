# Master Excel

Sibling of `master-page.html`. Color dictionaries from `master_sheet.xlsx`:

- `ExteriorColorDictionary`
- `InteriorColorDictionary`

## Files

```
master-excel.html                 ← open this (like master-page.html)
master-excel/
├── master-excel.js               ← color dictionary classes
├── formulas.js                   ← BusinessFormulas (all project formulas)
└── color-dictionaries.json       ← cleaned source data
```

## Classes (`master-excel.js`)

| Class | Role |
|-------|------|
| `ExteriorColor` | One exterior row (`code`, `name`) |
| `InteriorColor` | One interior row (`code`, `name`) |
| `ExteriorColorDictionary` | Lookup + `resolveCode()` / `resolveName()` |
| `InteriorColorDictionary` | Lookup + `resolveCode()` / `resolveName()` |
| `MasterExcelColors` | Combined exterior + interior resolver |

## Formulas (`formulas.js`)

| Class | Role |
|-------|------|
| `BusinessFormulas` | VIN normalize, match keys, Full Control statuses, sales Ach%/Diff, BO metrics, AD/AE fulfillable |

```html
<script src="master-excel/master-excel.js"></script>
<script src="master-excel/formulas.js"></script>
<script>
  const F = new BusinessFormulas();
  F.normalizeVin(" ab c-123 ");           // "ABC123"
  F.boMatchStatus(true);                  // "Matched"
  F.salesBlock(10, 8, 12, 1);             // Ach%, Del+VSND, Diff…
  console.table(BusinessFormulas.catalog()); // list every formula
</script>
```

## Usage

```html
<script src="master-excel/master-excel.js"></script>
<script>
const colors = new MasterExcel.MasterExcelColors();
colors.resolveExteriorCode('Platinum White Pearl MC 089'); // "089"
colors.resolveInteriorCode('Black 20'); // "20"
</script>
```

In Node:

```js
const { MasterExcelColors } = require('./master-excel/master-excel.js');
const { BusinessFormulas } = require('./master-excel/formulas.js');
```
