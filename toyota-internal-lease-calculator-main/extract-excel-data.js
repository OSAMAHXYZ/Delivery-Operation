const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// Excel file name
const excelFileName = 'Stock  BIT  Daily  Ev_63_2221828989391280325.xlsx';

try {
    console.log(`Reading Excel file: ${excelFileName}\n`);
    
    // Read the workbook
    const workbook = XLSX.readFile(excelFileName);
    
    console.log(`Found ${workbook.SheetNames.length} sheet(s): ${workbook.SheetNames.join(', ')}\n`);
    
    // Process each sheet
    const allData = {};
    
    workbook.SheetNames.forEach((sheetName, sheetIndex) => {
        console.log(`\n${'='.repeat(80)}`);
        console.log(`Processing Sheet ${sheetIndex + 1}: "${sheetName}"`);
        console.log('='.repeat(80));
        
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert to JSON with header row
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
            header: 1, 
            defval: '',
            raw: false 
        });
        
        if (jsonData.length === 0) {
            console.log('Sheet is empty.');
            allData[sheetName] = { columns: {}, rowCount: 0 };
            return;
        }
        
        // Get headers (first row)
        const headers = jsonData[0] || [];
        console.log(`\nFound ${headers.length} columns:`);
        headers.forEach((header, idx) => {
            console.log(`  Column ${idx + 1}: "${header}"`);
        });
        
        // Extract data by column
        const columnData = {};
        headers.forEach((header, colIndex) => {
            const columnName = header || `Column_${colIndex + 1}`;
            columnData[columnName] = [];
            
            // Extract all values from this column (skip header row)
            for (let rowIndex = 1; rowIndex < jsonData.length; rowIndex++) {
                const value = jsonData[rowIndex][colIndex];
                columnData[columnName].push(value !== undefined && value !== null ? value : '');
            }
        });
        
        // Display summary
        console.log(`\nData rows: ${jsonData.length - 1} (excluding header)`);
        console.log(`\nColumn Data Summary:`);
        Object.keys(columnData).forEach(columnName => {
            const values = columnData[columnName];
            const nonEmptyCount = values.filter(v => v !== '' && v !== null && v !== undefined).length;
            console.log(`  ${columnName}: ${values.length} values (${nonEmptyCount} non-empty)`);
        });
        
        // Store data for this sheet
        allData[sheetName] = {
            headers: headers,
            columns: columnData,
            rowCount: jsonData.length - 1,
            totalRows: jsonData.length
        };
        
        // Display sample data (first 5 rows)
        console.log(`\nSample Data (first 5 rows):`);
        const maxRows = Math.min(5, jsonData.length - 1);
        for (let i = 1; i <= maxRows; i++) {
            console.log(`\n  Row ${i}:`);
            headers.forEach((header, colIdx) => {
                const value = jsonData[i][colIdx];
                console.log(`    ${header || `Col_${colIdx + 1}`}: ${value !== undefined && value !== null ? value : '(empty)'}`);
            });
        }
    });
    
    // Save extracted data to JSON file
    const outputFileName = 'extracted-excel-data.json';
    fs.writeFileSync(outputFileName, JSON.stringify(allData, null, 2), 'utf8');
    console.log(`\n\n${'='.repeat(80)}`);
    console.log(`✓ All data extracted and saved to: ${outputFileName}`);
    console.log('='.repeat(80));
    
    // Also create a CSV summary
    let csvSummary = 'Sheet Name,Column Name,Row Count,Non-Empty Count\n';
    Object.keys(allData).forEach(sheetName => {
        const sheetData = allData[sheetName];
        Object.keys(sheetData.columns).forEach(columnName => {
            const values = sheetData.columns[columnName];
            const nonEmptyCount = values.filter(v => v !== '' && v !== null && v !== undefined).length;
            csvSummary += `"${sheetName}","${columnName}",${values.length},${nonEmptyCount}\n`;
        });
    });
    fs.writeFileSync('excel-columns-summary.csv', csvSummary, 'utf8');
    console.log(`✓ Column summary saved to: excel-columns-summary.csv\n`);
    
} catch (error) {
    console.error('Error reading Excel file:', error.message);
    process.exit(1);
}

