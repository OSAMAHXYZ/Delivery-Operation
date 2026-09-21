# Master Excel

Sibling of `master-page.html`. Color dictionaries from `master_sheet.xlsx`:

- `ExteriorColorDictionary`
- `InteriorColorDictionary`

## Files

```
master-excel.html                 ← open this (like master-page.html)
master-excel/
├── master-excel.js               ← classes
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
```
