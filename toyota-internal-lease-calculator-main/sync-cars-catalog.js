const fs = require('fs');
const path = require('path');

const root = __dirname;
const cars = JSON.parse(fs.readFileSync(path.join(root, 'cars-catalog.json'), 'utf8'));

const adminPath = path.join(root, 'admin-data.json');
const admin = JSON.parse(fs.readFileSync(adminPath, 'utf8'));
admin.cars = cars;
fs.writeFileSync(adminPath, JSON.stringify(admin, null, 2));

function toJs(carsObj) {
    const lines = ['{'];
    for (const [model, grades] of Object.entries(carsObj)) {
        lines.push(`    '${model.replace(/'/g, "\\'")}': [`);
        grades.forEach((g) => {
            const name = g.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            lines.push(`        { name: '${name}', price: ${g.price} },`);
        });
        lines.push('    ],');
    }
    lines.push('}');
    return lines.join('\n');
}

const jsCars = toJs(cars);

let server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
server = server.replace(
    /const defaultCars = \{[\s\S]*?\};\n\n\n\/\/ Initialize data file/,
    `const defaultCars = ${jsCars};\n\n\n// Initialize data file`
);
fs.writeFileSync(path.join(root, 'server.js'), server);

let html = fs.readFileSync(path.join(root, 'simple-app.html'), 'utf8');
const initialBlock = `cars: ${jsCars.replace(/^/gm, '            ').replace(/^\{/, '{').replace(/\n\}$/, '\n            }\n        };')}`;
html = html.replace(/selectedYear: null,\n            cars:\s*\{[\s\S]*?\n            \}\n        \};/, `selectedYear: null,\n            ${initialBlock}`);

const fallbackJs = `appData.cars = ${jsCars.replace(/^/gm, '                    ').replace(/^\{/, '{').replace(/\n\}$/, '\n                };')}`;
html = html.replace(/appData\.cars = \{[\s\S]*?\n                \};/, fallbackJs);
fs.writeFileSync(path.join(root, 'simple-app.html'), html);

console.log('Synced cars to admin-data.json, server.js, simple-app.html');
