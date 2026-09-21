const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const XLSX = require('xlsx');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { resolveToyotaCarImage } = require('./scripts/toyota-car-images');
const { BoOrderLookup } = require('./scripts/bo-order-lookup');

const app = express();
const PORT = process.env.PORT || 8000;
const DELIVERY_NOTE_TEMPLATE = path.join(__dirname, 'muthakara_template.docx');

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));

// Delivery hub lives in /delivery-hub — keep old root URLs working (before static)
function redirectDeliveryHubPage(filename) {
    return (req, res) => {
        const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        res.redirect(302, `/delivery-hub/${filename}${qs}`);
    };
}
app.get('/Delivery_pdf.html', redirectDeliveryHubPage('Delivery_pdf.html'));
app.get('/Delivery_coordinator.html', redirectDeliveryHubPage('Delivery_coordinator.html'));
app.get('/admin-Delivery-pdf.html', redirectDeliveryHubPage('admin-Delivery-pdf.html'));
app.get('/delivery-hub', (req, res) => res.redirect(302, '/delivery-hub/Delivery_pdf.html'));
app.get('/delivery-hub/', (req, res) => res.redirect(302, '/delivery-hub/Delivery_pdf.html'));

// BO hub lives in /bo-hub — keep old root URLs working (before static)
function redirectBoHubPage(filename) {
    return (req, res) => {
        const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        res.redirect(302, `/bo-hub/${filename}${qs}`);
    };
}
app.get('/bo-order-lookup.html', redirectBoHubPage('bo-order-lookup.html'));
app.get('/bo-data-admin.html', redirectBoHubPage('bo-data-admin.html'));
app.get('/bo-hub', (req, res) => res.redirect(302, '/bo-hub/bo-order-lookup.html'));
app.get('/bo-hub/', (req, res) => res.redirect(302, '/bo-hub/bo-order-lookup.html'));

// Serve static files (HTML)
app.use(express.static(__dirname));

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'simple-app.html'));
});

function splitDateParts(value) {
    if (!value) return { d: '', m: '', y: '' };
    const s = String(value).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return { y: iso[1], m: iso[2], d: iso[3] };
    const dmy = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (dmy) return { d: dmy[1], m: dmy[2], y: dmy[3] };
    return { d: '', m: '', y: '' };
}

function buildDeliveryNotePayload(body = {}) {
    const todaySaudi = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
    const docDate = splitDateParts(body.doc_date || todaySaudi);
    const transferDate = splitDateParts(body.transfer_date || body.doc_date || todaySaudi);
    const correspondingDate = splitDateParts(body.corresponding_date || body.transfer_date || body.doc_date || todaySaudi);
    const payload = {
        date_d: docDate.d,
        date_m: docDate.m,
        date_y: docDate.y,
        memo_number: body.invoice_number || body.memo_number || '',
        invoice_number: body.invoice_number || body.memo_number || '',
        dep_hour: body.dep_hour || '',
        dep_minute: body.dep_minute || '',
        customer_name: body.customer_name || '',
        company_rep: body.company_rep || '',
        transfer_d: transferDate.d,
        transfer_m: transferDate.m,
        transfer_y: transferDate.y,
        corresponding_d: correspondingDate.d,
        corresponding_m: correspondingDate.m,
        corresponding_y: correspondingDate.y,
        day_name: body.day_name || '',
        trailer_number: body.trailer_number || '',
        car_count: body.car_count || '',
        branch_to: body.branch_to || '',
        attachments: body.attachments || '',
        warehouse_supervisor_sign: body.warehouse_supervisor_sign || '',
        transport_rep_sign: body.transport_rep_sign || '',
        received_intact_mark: body.received_intact ? '☑' : '☐',
        received_damaged_mark: body.received_damaged ? '☑' : '☐',
        recipient_name: body.recipient_name || '',
        recipient_signature: body.recipient_signature || '',
        recipient_date: body.recipient_date || '',
        rec_hour: body.rec_hour || '',
        rec_minute: body.rec_minute || '',
        branch_stamp: body.branch_stamp || ''
    };
    const cars = Array.isArray(body.cars) ? body.cars : [];
    for (let i = 1; i <= 10; i++) {
        const row = cars[i - 1] || {};
        payload[`car${i}_model`] = row.model || '';
        payload[`car${i}_chassis`] = row.chassis || '';
        payload[`car${i}_plate`] = row.plate || '';
        payload[`car${i}_remarks`] = row.remarks || '';
    }
    return payload;
}

app.post('/api/delivery-note/generate', (req, res) => {
    try {
        if (!fs.existsSync(DELIVERY_NOTE_TEMPLATE)) {
            return res.status(500).json({ error: 'Delivery note template is missing on the server.' });
        }
        const content = fs.readFileSync(DELIVERY_NOTE_TEMPLATE, 'binary');
        const zip = new PizZip(content);
        const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
        doc.render(buildDeliveryNotePayload(req.body));
        const buffer = doc.getZip().generate({ type: 'nodebuffer' });
        const filename = `muthakara_tarhil_${Date.now()}.docx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (err) {
        console.error('Delivery note generation failed:', err);
        res.status(500).json({ error: err.message || 'Failed to generate delivery note' });
    }
});

// Data file path
const DATA_FILE = path.join(__dirname, 'admin-data.json');
const QUEUE_LOG_FILE = path.join(__dirname, 'queue-log.json');
const BO_DATA_FILE = path.join(__dirname, 'bo-data.json');
const BO_LOOKUP_STATS_FILE = path.join(__dirname, 'bo-lookup-stats.json');
const DELIVERY_INVENTORY_FILE = path.join(__dirname, 'delivery-inventory-data.json');

// Default bank settings
const defaultBanks = [
    { id: 1, name: 'Bank 1', interestRate: 5.5, maxSalaryPercentage: 33, minDownPayment: 0, profitRate: 3.5, insuranceRate: 2.5, balloonPayment: 40, commissionRate: 1.8, hasSpecialOffer: true, specialOfferFirstPercent: 50, specialOfferSecondPercent: 50, specialOfferYears: 2, specialOfferProfitRate: 0, specialOfferCrownProfitRate: 1.54, specialOfferAdminFees: 1 },
    { 
        id: 2, 
        name: 'Bank Al-INMA', 
        interestRate: 4.8, 
        maxSalaryPercentage: 33, 
        minDownPayment: 0, 
        profitRate: 4.8, 
        insuranceRate: 2.5, 
        balloonPayment: 45, 
        commissionRate: 1.0, 
        adminFees: 1.0, 
        campaign: "Q4 2025",
        hasSpecialOffer: true,
        specialOfferFirstPercent: 50,
        specialOfferSecondPercent: 50,
        specialOfferYears: 2,
        specialOfferAdminFees: 1.0,
        specialOfferProfitRate: 0.6,
        specialOfferCrownProfitRate: 1.54,
        specialRates: {
            // 2024 rates
            'Raize_2024': { ST: 2.11, NST: 2.11 },
            
            // 2025 rates (empty cars default to 4.8%)
            'Yaris_2025': { ST: 4.8, NST: 4.8 },
            'Corolla_2025': { ST: 4.8, NST: 4.8 },
            'Corolla_HEV_2025': { ST: 4.8, NST: 4.8 },
            'Camry_2025': { ST: 4.8, NST: 4.8 },
            'Crown_2025': { ST: 4.8, NST: 4.8 },
            'GR86_2025': { ST: 4.8, NST: 4.8 },
            'Supra_2025': { ST: 4.8, NST: 4.8 },
            'Raize_2025': { ST: 4.8, NST: 4.8 },
            'Urban_Cruiser_2025': { ST: 2.11, NST: 2.11 },
            'Corolla_Cross_2025': { ST: 2.98, NST: 2.98 },
            'RAV4_2025': { ST: 4.8, NST: 4.8 },
            'Fortuner_2025': { ST: 1.99, NST: 1.99 },
            'Prado_2025': { ST: 4.8, NST: 4.8 },
            'Land_Cruiser_2025': { ST: 4.8, NST: 4.8 },
            'Highlander_2025': { ST: 2.98, NST: 2.98 },
            'Veloz_2025': { ST: 2.11, NST: 2.11 },
            'Innova_2025': { ST: 3.0, NST: 3.0 },
            'Hilux_DC_2025': { ST: 2.11, NST: 2.11 },
            'Hilux_SC_2025': { ST: 2.11, NST: 2.11 },
            
            // 2026 rates (empty cars default to 4.8%)
            'Yaris_2026': { ST: 2.63, NST: 2.63 },
            'Corolla_HEV_2026': { ST: 3.07, NST: 3.07 },
            'Corolla_2026': { ST: 2.63, NST: 2.63 },
            'Camry_HEV_2026': { ST: 2.98, NST: 2.98 },
            'Crown_2026': { ST: 3.33, NST: 3.33 },
            'GR86_2026': { ST: 4.8, NST: 4.8 },
            'Supra_2026': { ST: 4.8, NST: 4.8 },
            'Raize_2026': { ST: 2.11, NST: 2.11 },
            'Urban_Cruiser_2026': { ST: 2.46, NST: 2.46 },
            'Corolla_Cross_2026': { ST: 4.8, NST: 4.8 },
            'RAV4_2026': { ST: 4.8, NST: 4.8 },
            'Fortuner_2026': { ST: 2.98, NST: 2.98 },
            'Prado_2026': { ST: 4.8, NST: 4.8 },
            'Land_Cruiser_2026': { ST: 2.81, NST: 2.81 },
            'Highlander_2026': { ST: 4.8, NST: 4.8 },
            'Veloz_2026': { ST: 4.8, NST: 4.8 },
            'Innova_2026': { ST: 2.98, NST: 2.98 },
            'Hilux_DC_2026': { ST: 2.46, NST: 2.46 },
            'Hilux_SC_2026': { ST: 2.46, NST: 2.46 }
        }
    },
    { 
        id: 3, 
        name: 'snb bank', 
        interestRate: 4.75, 
        maxSalaryPercentage: 30, 
        minDownPayment: 0, 
        profitRate: 4.75, 
        insuranceRate: 2.5, 
        balloonPayment: 50, 
        commissionRate: 2.0, 
        adminFees: 0,
        hasSpecialOffer: false,
        specialOfferFirstPercent: 50,
        specialOfferSecondPercent: 50,
        specialOfferYears: 0,
        specialRates: {
            // 2024 rates (empty cars default to 4.75%)
            'Raize_2024': { ST: 2.4, NST: 2.4 },
            
            // 2025 rates (empty cars default to 4.75%)
            'Urban_Cruiser_2025': { ST: 2.4, NST: 2.4 },
            'Corolla_Cross_2025': { ST: 2.4, NST: 2.4 },
            'Highlander_2025': { ST: 2.4, NST: 2.4 },
            'Veloz_2025': { ST: 2.4, NST: 2.4 },
            'Hilux_DC_2025': { ST: 2.4, NST: 2.4 },
            'Hilux_SC_2025': { ST: 2.4, NST: 2.4 },
            
            // 2026 rates (empty cars default to 4.75%)
            'Yaris_2026': { ST: 2.99, NST: 2.99 },
            'Corolla_2026': { ST: 2.99, NST: 2.99 },
            'Corolla_HEV_2026': { ST: 3.5, NST: 3.5 },
            'Camry_HEV_2026': { ST: 3.4, NST: 3.4 },
            'Crown_2026': { ST: 3.8, NST: 3.8 },
            'Raize_2026': { ST: 2.4, NST: 2.4 },
            'Urban_Cruiser_2026': { ST: 2.8, NST: 2.8 },
            'Fortuner_2026': { ST: 3.4, NST: 3.4 },
            'Land_Cruiser_2026': { ST: 3.2, NST: 3.2 },
            'Veloz_2026': { ST: 4.75, NST: 4.75 },
            'Innova_2026': { ST: 2.4, NST: 2.4 },
            'Hilux_DC_2026': { ST: 2.4, NST: 2.4 },
            'Hilux_SC_2026': { ST: 2.4, NST: 2.4 }
        }
    },
    { id: 4, name: 'Bank 4', interestRate: 10.0, maxSalaryPercentage: 0, minDownPayment: 0, profitRate: 3.5, insuranceRate: 2.5, balloonPayment: 35, commissionRate: 1.0, hasSpecialOffer: false, specialOfferFirstPercent: 50, specialOfferSecondPercent: 50, specialOfferYears: 0 },
    { id: 5, name: 'Bank 5', interestRate: 5.8, maxSalaryPercentage: 32, minDownPayment: 0, profitRate: 3.5, insuranceRate: 2.5, balloonPayment: 40, commissionRate: 2.2, hasSpecialOffer: false, specialOfferFirstPercent: 50, specialOfferSecondPercent: 50, specialOfferYears: 0 },
    { 
        id: 6, 
        name: 'al jazira bank', 
        interestRate: 4.75, 
        maxSalaryPercentage: 0, 
        minDownPayment: 0, 
        profitRate: 4.75, 
        insuranceRate: 2.5, 
        balloonPayment: 50, 
        commissionRate: 1.0, 
        adminFees: 1.0,
        hasSpecialOffer: false,
        specialOfferFirstPercent: 50,
        specialOfferSecondPercent: 50,
        specialOfferYears: 0,
        specialOfferAdminFees: 0.5,
        specialOfferProfitRate: 0.6,
        specialOfferCrownProfitRate: 2.15,
        specialRates: {
            // 2024 rates
            'Raize_2024': { ST: 1.99, NST: 1.99 },
            
            // 2025 rates (empty cars default to 4.75%)
            'Yaris_2025': { ST: 4.75, NST: 4.75 },
            'Corolla_2025': { ST: 4.75, NST: 4.75 },
            'Corolla_HEV_2025': { ST: 4.75, NST: 4.75 },
            'Camry_2025': { ST: 4.75, NST: 4.75 },
            'Crown_2025': { ST: 4.75, NST: 4.75 },
            'GR86_2025': { ST: 4.75, NST: 4.75 },
            'Supra_2025': { ST: 4.75, NST: 4.75 },
            'Raize_2025': { ST: 4.75, NST: 4.75 },
            'Urban_Cruiser_2025': { ST: 1.99, NST: 1.99 },
            'Corolla_Cross_2025': { ST: 3.0, NST: 3.0 },
            'RAV4_2025': { ST: 4.75, NST: 4.75 },
            'Fortuner_2025': { ST: 1.99, NST: 1.99 },
            'Prado_2025': { ST: 4.75, NST: 4.75 },
            'Land_Cruiser_2025': { ST: 4.75, NST: 4.75 },
            'Highlander_2025': { ST: 3.0, NST: 3.0 },
            'Veloz_2025': { ST: 1.99, NST: 1.99 },
            'Innova_2025': { ST: 3.0, NST: 3.0 },
            'Hilux_DC_2025': { ST: 1.99, NST: 1.99 },
            'Hilux_SC_2025': { ST: 1.99, NST: 1.99 },
            
            // 2026 rates (empty cars default to 4.75%)
            'Yaris_2026': { ST: 2.55, NST: 2.55 },
            'Corolla_HEV_2026': { ST: 2.55, NST: 2.55 },
            'Camry_HEV_2026': { ST: 3.0, NST: 3.0 },
            'Crown_2026': { ST: 3.45, NST: 3.45 },
            'GR86_2026': { ST: 4.75, NST: 4.75 },
            'Supra_2026': { ST: 4.75, NST: 4.75 },
            'Raize_2026': { ST: 1.99, NST: 1.99 },
            'Urban_Cruiser_2026': { ST: 2.39, NST: 2.39 },
            'Corolla_Cross_2026': { ST: 4.75, NST: 4.75 },
            'RAV4_2026': { ST: 4.75, NST: 4.75 },
            'Fortuner_2026': { ST: 3.0, NST: 3.0 },
            'Prado_2026': { ST: 4.75, NST: 4.75 },
            'Land_Cruiser_2026': { ST: 2.9, NST: 2.9 },
            'Highlander_2026': { ST: 4.75, NST: 4.75 },
            'Veloz_2026': { ST: 4.75, NST: 4.75 },
            'Innova_2026': { ST: 4.75, NST: 4.75 },
            'Hilux_DC_2026': { ST: 2.39, NST: 2.39 },
            'Hilux_SC_2026': { ST: 2.39, NST: 2.39 }
        }
    },
    { id: 7, name: 'BSF bank', interestRate: 6.0, maxSalaryPercentage: 0, minDownPayment: 0, profitRate: 3.5, insuranceRate: 2.5, balloonPayment: 40, commissionRate: 1.0, hasSpecialOffer: false, specialOfferFirstPercent: 50, specialOfferSecondPercent: 50, specialOfferYears: 0 }
];

// Default car settings
const defaultCars = {
    'Yaris': [
        { name: 'Y', price: 66987.5 },
        { name: 'Y Limited', price: 66700 },
        { name: 'Y Plus', price: 72852.5 },
        { name: 'YX', price: 78832.5 },
    ],
    'Corolla': [
        { name: '1.5L XLI', price: 82627.5 },
        { name: '1.5L XLI Executive', price: 86307.5 },
        { name: '1.8L XLI Hybrid', price: 92057.5 },
        { name: '1.8L XLI Executive HEV M/R', price: 101832.5 },
        { name: '2.0L XLI', price: 86882.5 },
        { name: '2.0L XLI Executive', price: 90332.5 },
        { name: '2.0L XLI Executive MR', price: 97577.5 },
        { name: '2.0L GLI MR', price: 102292.5 },
    ],
    'Camry': [
        { name: 'E', price: 109825 },
        { name: 'LE', price: 121555 },
        { name: 'GRANDE', price: 145475 },
        { name: 'E HEV', price: 111090 },
        { name: 'HEV LE', price: 124545 },
        { name: 'HEV Lumiere', price: 153985 },
        { name: 'E PLUS HEV', price: 116035 },
    ],
    'Raize': [
        { name: 'XLE 1.2', price: 68827.5 },
        { name: 'Limited 1.0T', price: 75497.5 },
    ],
    'Urban Cruiser': [
        { name: 'XR', price: 84755 },
        { name: 'GL', price: 93955 },
    ],
    'Corolla Cross': [
        { name: 'LE HEV', price: 103845 },
        { name: 'XLE HEV', price: 113505 },
        { name: 'Limited HEV', price: 127206 },
        { name: 'Limited PLUS HEV', price: 130410 },
    ],
    'RAV4': [
        { name: 'LE 4X2', price: 106662.5 },
        { name: 'LE 4X4', price: 112642.5 },
        { name: 'XLE 4X4', price: 129317.5 },
        { name: 'Adventure', price: 145590 },
        { name: 'HEV LE 4X2', price: 111377.5 },
        { name: 'HEV LE 4X4', price: 117357.5 },
        { name: 'HEV XLE 4X4', price: 138862.5 },
        { name: 'HEV XSE 4X4', price: 161977.5 },
        { name: 'HEV LTD 4X4', price: 165542.5 },
    ],
    'Fortuner': [
        { name: 'GX2 4X2', price: 128742.5 },
        { name: 'GX2 4X4', price: 139552.5 },
        { name: 'GX2 4X4 DSL', price: 151972.5 },
        { name: 'VX1 4.0', price: 162897.5 },
        { name: 'VX2 DSL 4.0', price: 186817.5 },
        { name: 'VX3 4.0', price: 187047.5 },
    ],
    'Prado': [
        { name: 'TX-2', price: 199582.5 },
        { name: 'TXL-1', price: 213957.5 },
        { name: 'TXL-3', price: 238107.5 },
        { name: 'ADV-2', price: 279622.5 },
        { name: 'ADV-2 2T', price: 273815 },
        { name: 'VXL-3', price: 294112.5 },
        { name: 'TX-2 DSL', price: 207057.5 },
        { name: 'TXL-2 DSL', price: 230057.5 },
        { name: 'ADV-1 DSL', price: 255357.5 },
    ],
    'Land Cruiser': [
        { name: 'GXR', price: 263407.5 },
        { name: 'GXR2', price: 281347.5 },
        { name: 'GXR3', price: 310557.5 },
        { name: 'GXR4', price: 322632.5 },
        { name: 'VX', price: 387032.5 },
        { name: 'VXR', price: 423947.5 },
    ],
    'LC300 HEV MAX': [
        { name: 'GXR HEV MAX', price: 327290 },
        { name: 'GXR-S HEV MAX', price: 334535 },
    ],
    'Hilux Single Cab': [
        { name: 'Single Cab GLX 4X2 2.7', price: 99877.5 },
        { name: 'Single Cab GLX 4X4 2.7', price: 113907.5 },
        { name: 'Deckless 2.8 4X2', price: 88090 },
        { name: 'GL DSL 4X2 MT', price: 99992.5 },
        { name: 'GL DSL 4X2 MT 2.8', price: 104362.5 },
        { name: 'GLX DSL 4X4', price: 120692.5 },
        { name: 'GLX 2.8 DSL 4X4 MT', price: 128972.5 },
        { name: 'GLX 2.8 DSL 4X4 AT', price: 143607.5 },
    ],
    'Hilux Double Cab': [
        { name: 'GLX1 2.7L 4X2 AT', price: 120865 },
        { name: 'GLX2 2.7L 4X2 MT', price: 123280 },
        { name: 'SGLX 2.7L 4X4 MT', price: 142772.5 },
        { name: 'SGLX 2.7L 4X4 AT', price: 148177.5 },
        { name: 'Adventure 4.0L 4X4 AT', price: 174455 },
        { name: 'GR-S 4.0L 4X4 AT', price: 183885 },
        { name: 'GR-S Rally Edition 4.0L 4X4 AT', price: 186300 },
        { name: 'GL 2.4L DSL 4X2 MT', price: 113850 },
        { name: 'GL2 2.4L DSL 4X4 MT', price: 132192.5 },
        { name: 'SGLX 2.4L DSL 4X4 AT', price: 165312.5 },
        { name: 'SGLX 2.8L DSL 4X4 AT', price: 175087.5 },
    ],
    'Highlander': [
        { name: 'LE HEV', price: 151455 },
        { name: 'GLE HEV', price: 168360 },
        { name: 'GLE PLUS HEV 4X4', price: 176870 },
        { name: 'Limited HEV', price: 207460 },
    ],
    'Innova': [
        { name: 'GL', price: 127765 },
        { name: 'GLX', price: 137425 },
        { name: 'Limited', price: 149500 },
    ],
    'Veloz': [
        { name: 'GLX', price: 84007.5 },
    ],
    'Crown': [
        { name: 'Majesta', price: 158355 },
        { name: 'Premium', price: 170315 },
        { name: 'Platinum', price: 206195 },
    ],
    'GR86': [
        { name: 'MT', price: 147487.5 },
        { name: 'AT', price: 147487.5 },
    ],
    'Supra': [
        { name: 'AT', price: 287760 },
        { name: 'Manual', price: 287760 },
    ],
    'Land Cruiser Hardtop': [
        { name: 'DX MT V6', price: 158240 },
        { name: 'DX AT', price: 163070 },
        { name: 'DLX3 AT', price: 179170 },
        { name: 'S-DLX AT', price: 191360 },
        { name: 'DLX2 DSL AT', price: 185035 },
        { name: 'S-DXL DSL AT', price: 201192.5 },
    ],
    'Land Cruiser Pickup': [
        { name: 'S-DLX - SC 4x4 AT', price: 189520 },
        { name: 'S-DLX - DC 4x4 AT', price: 201710 },
        { name: 'DX DSL - SC 4x4 AT', price: 168705 },
        { name: 'DLX2 DSL - SC 4x4 AT', price: 179802.5 },
        { name: 'S-DLX DSL - SC 4x4 AT', price: 195787.5 },
        { name: 'DX DSL - SC 4x4 MT', price: 165025 },
        { name: 'DLX3 DSL - SC 4x4 MT', price: 176180 },
    ],
    'Lite Ace': [
        { name: 'Panel Van M/T', price: 69575 },
        { name: 'Panel Van A/T', price: 72565 },
    ],
    'Hiace Van': [
        { name: 'STD GAS MT', price: 122360 },
        { name: 'STD DSL MT', price: 131215 },
        { name: 'HIGH ROOF GAS MT', price: 139207.5 },
        { name: 'SWING BACKDOOR GAS MT', price: 138115 },
        { name: 'HIGH ROOF DSL MT', price: 149557.5 },
        { name: 'SWING BACKDOOR DSL AT', price: 157032.5 },
    ],
    'Hiace Bus': [
        { name: 'GAS MT', price: 156630 },
        { name: 'DSL MT', price: 166060 },
        { name: 'DSL AT', price: 170890 },
    ],
    'Coaster': [
        { name: 'GAS', price: 250930 },
        { name: 'DSL', price: 260590 },
    ],
};


// Initialize data file if it doesn't exist
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ 
        banks: defaultBanks, 
        cars: defaultCars
    }, null, 2));
}

// Get current bank settings
app.get('/api/banks', (req, res) => {
    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        res.json(data);
    } catch (error) {
        console.error('Error reading banks data:', error);
        res.json({ banks: defaultBanks, cars: defaultCars });
    }
});

// Get current car settings
app.get('/api/cars', (req, res) => {
    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        res.json({ cars: data.cars || defaultCars });
    } catch (error) {
        console.error('Error reading cars data:', error);
        res.json({ cars: defaultCars });
    }
});


// Update bank settings (admin only)
// Backend password
const BACKEND_PASSWORD = '1234';

// Authentication middleware
function authenticateBackend(req, res, next) {
    // Check password from body (POST) or query (GET)
    const password = req.body?.password || req.query?.password;
    if (password === BACKEND_PASSWORD) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized: Invalid password' });
    }
}

function normalizeText(value) {
    return String(value ?? '').trim().toLowerCase();
}

function resolveColumn(headers, patterns) {
    for (const pattern of patterns) {
        const match = headers.find((header) => pattern.test(String(header || '')));
        if (match) return match;
    }
    return null;
}

function parseDateValue(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date && !isNaN(value.getTime())) return value.getTime();

    if (typeof value === 'number') {
        // Excel serial date fallback
        const epoch = new Date(Date.UTC(1899, 11, 30));
        const ms = epoch.getTime() + value * 24 * 60 * 60 * 1000;
        return ms;
    }

    const parsed = Date.parse(String(value));
    return isNaN(parsed) ? null : parsed;
}

function sanitizeHeaderName(value, index) {
    const cleaned = String(value ?? '').trim();
    return cleaned || `Column_${index + 1}`;
}

function detectHeaderRowIndex(grid) {
    if (!Array.isArray(grid) || grid.length === 0) return 0;

    const keywordPatterns = [
        /order/i,
        /back\s*order/i,
        /date/i,
        /product/i,
        /suffix/i,
        /dealer/i,
        /customer/i
    ];

    let bestIdx = 0;
    let bestScore = -1;

    const scanLimit = Math.min(grid.length, 40);
    for (let i = 0; i < scanLimit; i++) {
        const row = Array.isArray(grid[i]) ? grid[i] : [];
        const cells = row.map((c) => String(c ?? '').trim()).filter(Boolean);
        if (cells.length === 0) continue;

        const keywordHits = cells.reduce((acc, cell) => {
            return acc + (keywordPatterns.some((pattern) => pattern.test(cell)) ? 1 : 0);
        }, 0);

        // Prefer rows with many filled cells and known header keywords.
        const score = keywordHits * 10 + cells.length;
        if (score > bestScore) {
            bestScore = score;
            bestIdx = i;
        }
    }

    return bestIdx;
}

function parseSheetWithDetectedHeader(worksheet) {
    const grid = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    if (!grid.length) {
        return { headers: [], rows: [] };
    }

    const headerRowIndex = detectHeaderRowIndex(grid);
    const rawHeaders = (grid[headerRowIndex] || []).map((h, idx) => sanitizeHeaderName(h, idx));

    // Keep only columns with a non-empty header and at least one non-empty value below header.
    const includedIndexes = rawHeaders
        .map((header, idx) => ({ header, idx }))
        .filter(({ header, idx }) => {
            if (!header || /^Column_\d+$/i.test(header)) return false;
            for (let r = headerRowIndex + 1; r < grid.length; r++) {
                const val = String((grid[r] || [])[idx] ?? '').trim();
                if (val) return true;
            }
            return false;
        })
        .map(({ idx }) => idx);

    const headers = includedIndexes.map((idx) => rawHeaders[idx]);
    const rows = [];

    for (let r = headerRowIndex + 1; r < grid.length; r++) {
        const rowArray = grid[r] || [];
        const rowObj = {};
        let hasValue = false;

        includedIndexes.forEach((colIdx, pos) => {
            const value = rowArray[colIdx] ?? '';
            rowObj[headers[pos]] = value;
            if (String(value).trim() !== '') hasValue = true;
        });

        if (hasValue) rows.push(rowObj);
    }

    return { headers, rows };
}

function resolveOrderColumns(headers) {
    const priorityPatterns = [
        /order\s*no/i,
        /order\s*number/i,
        /^bo$/i,
        /bo\s*number/i,
        /sales\s*order/i,
        /so\s*number/i,
        /request\s*number/i
    ];

    const prioritized = [];
    headers.forEach((header) => {
        const headerText = String(header || '');
        if (priorityPatterns.some((pattern) => pattern.test(headerText))) {
            prioritized.push(header);
        }
    });

    return prioritized.length > 0 ? prioritized : headers;
}

function findOrderRow(rows, orderNumber, headers) {
    const needle = normalizeText(orderNumber);
    if (!needle) return null;

    const candidateColumns = resolveOrderColumns(headers);
    for (const row of rows) {
        for (const columnName of candidateColumns) {
            if (normalizeText(row[columnName]) === needle) {
                return { row, matchedColumn: columnName };
            }
        }
    }

    // Fallback: search all fields for exact value match.
    for (const row of rows) {
        for (const key of Object.keys(row)) {
            if (normalizeText(row[key]) === needle) {
                return { row, matchedColumn: key };
            }
        }
    }

    return null;
}

function resolveModelYearColumn(headers) {
    return resolveColumn(headers, [
        /^model\s*year$/i,
        /model\s*year/i,
        /^vehicle\s*year$/i,
        /^mod\.?\s*year$/i,
        /^\s*my\s*$/i
    ]);
}

/** Match Excel VLOOKUP keys when Model Year is stored as a number or string (e.g. 2026 vs "2026.0"). */
function normalizeModelYearForMatch(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
    const s = String(value).trim().replace(/,/g, '');
    if (s === '') return '';
    if (/^\d+(\.\d+)?$/.test(s)) {
        const n = parseFloat(s);
        if (!Number.isNaN(n) && Number.isFinite(n)) return String(Math.trunc(n));
    }
    return normalizeText(s);
}

function resolvePriorityColumn(headers, kind, priority) {
    const p = String(priority);
    const patterns = kind === 'ext'
        ? [
            new RegExp(`^ext\\.?\\s*color\\s*${p}\\b`, 'i'),
            new RegExp(`^exterior\\s*color\\s*${p}\\b`, 'i'),
            new RegExp(`^ext\\.?\\s*color\\s*priority\\s*${p}\\b`, 'i'),
            new RegExp(`^exterior\\s*color\\s*priority\\s*${p}\\b`, 'i'),
            new RegExp(`ext\\.?\\s*color\\s*priority\\s*${p}`, 'i'),
            new RegExp(`exterior.*priority.*${p}`, 'i'),
            new RegExp(`exterior.*color.*${p}`, 'i')
        ]
        : [
            new RegExp(`^inter\\.?\\s*color\\s*${p}\\b`, 'i'),
            new RegExp(`^int\\.?\\s*color\\s*${p}\\b`, 'i'),
            new RegExp(`^interior\\s*color\\s*${p}\\b`, 'i'),
            new RegExp(`^int\\.?\\s*color\\s*priority\\s*${p}\\b`, 'i'),
            new RegExp(`^interior\\s*color\\s*priority\\s*${p}\\b`, 'i'),
            new RegExp(`int\\.?\\s*color\\s*priority\\s*${p}`, 'i'),
            new RegExp(`interior.*priority.*${p}`, 'i'),
            new RegExp(`interior.*color.*${p}`, 'i')
        ];
    return resolveColumn(headers, patterns);
}

/**
 * True if norm appears in any of up to three BO priority columns (e.g. Ext Color 1/2/3).
 * Used so queue peers match a color regardless of which preference slot it was entered in.
 */
function rowHasColorInAnyPrioritySlot(row, col1, col2, col3, norm) {
    const target = normalizeText(norm);
    if (!target || target === '-' || target === '*') return false;
    for (const col of [col1, col2, col3].filter(Boolean)) {
        const n = normalizeText(row[col]);
        if (!n || n === '-' || n === '*') continue;
        if (n === target) return true;
    }
    return false;
}

/** BO column for reservation / queue ordering: prefer explicit created_date. */
function resolveReservationCreatedDateColumn(headers) {
    return resolveColumn(headers, [
        /^created_date$/i,
        /\bcreated\s*date\b/i,
        /^reservation\s*created\s*date$/i,
        /\breservation.*created\b/i,
        /^order\s*created\s*on$/i,
        /order\s*created\s*on/i,
        /order\s*date/i,
        /\bdate\b/i,
        /created/i
    ]);
}

function compareOrderNumberValues(a, b) {
    return String(a ?? '')
        .trim()
        .localeCompare(String(b ?? '').trim(), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Queue priority: reservation creation time ascending (oldest first).
 * Order number is used only when both rows have the same parseable creation timestamp (tie-break).
 * Rows with no parseable date sort after rows with a date; among missing dates, row order is stable via sheet index only.
 */
function compareReservationPriority(rowA, rowB, dateColumn, orderColumn) {
    const da = dateColumn ? parseDateValue(rowA[dateColumn]) : null;
    const db = dateColumn ? parseDateValue(rowB[dateColumn]) : null;
    if (da !== null && db !== null && da !== db) return da < db ? -1 : 1;
    if (da !== null && db === null) return -1;
    if (da === null && db !== null) return 1;
    const sameTimestamp = da !== null && db !== null && da === db;
    if (sameTimestamp && orderColumn) {
        const oc = compareOrderNumberValues(rowA[orderColumn], rowB[orderColumn]);
        if (oc !== 0) return oc;
    }
    return 0;
}

function sortPeersByReservationDate(peers, dateColumn, orderColumn) {
    return [...peers].sort((a, b) => {
        const c = compareReservationPriority(a.row, b.row, dateColumn, orderColumn);
        if (c !== 0) return c;
        return a.index - b.index;
    });
}

/** Primary BO order column for merging duplicate order numbers into one queue slot. */
function resolvePrimaryOrderColumnForDedupe(headers) {
    return (
        resolveColumn(headers, [/^order\s*no\.?$/i, /order\s*number/i, /back\s*order\s*number/i]) ||
        resolveOrderColumns(headers)[0] ||
        null
    );
}

/**
 * One row per distinct order number (queue math only). Earliest reservation date wins;
 * tie-break by sheet row index. Rows with blank order column are never merged with each other.
 */
function dedupeRowsByOrderNumberForQueue(rows, headers) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const groupCol = resolvePrimaryOrderColumnForDedupe(headers);
    if (!groupCol) return rows.slice();

    const dateColumn = resolveReservationCreatedDateColumn(headers);
    const groups = new Map();
    rows.forEach((row, index) => {
        const k = normalizeText(String(row[groupCol] ?? ''));
        const key = k || `__singleton_${index}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ row, index });
    });
    const out = [];
    groups.forEach((items) => {
        const sorted = [...items].sort((a, b) => {
            const c = compareReservationPriority(a.row, b.row, dateColumn, groupCol);
            if (c !== 0) return c;
            return a.index - b.index;
        });
        out.push(sorted[0].row);
    });
    return out;
}

/** Representative row for queue: earliest date among all lines sharing this order number. */
function canonicalRowForOrderGroup(rows, headers, matchedRow, matchedColumn) {
    const groupCol = resolvePrimaryOrderColumnForDedupe(headers);
    const dateColumn = resolveReservationCreatedDateColumn(headers);
    const orderTieCol = groupCol || matchedColumn;
    let pool = rows.map((row, index) => ({ row, index }));

    if (groupCol && normalizeText(String(matchedRow[groupCol] ?? ''))) {
        const g = normalizeText(String(matchedRow[groupCol] ?? ''));
        pool = pool.filter(({ row }) => normalizeText(String(row[groupCol] ?? '')) === g);
    } else if (matchedColumn && normalizeText(String(matchedRow[matchedColumn] ?? ''))) {
        const n = normalizeText(String(matchedRow[matchedColumn] ?? ''));
        pool = pool.filter(({ row }) => normalizeText(String(row[matchedColumn] ?? '')) === n);
    } else {
        const idx = rows.indexOf(matchedRow);
        pool = [{ row: matchedRow, index: idx >= 0 ? idx : 0 }];
    }

    if (!pool.length) return matchedRow;

    pool.sort((a, b) => {
        const c = compareReservationPriority(a.row, b.row, dateColumn, orderTieCol);
        if (c !== 0) return c;
        return a.index - b.index;
    });
    return pool[0].row;
}

/** All raw rows for this order number (from first sheet) for display. */
function findOrderUnitsSorted(rows, headers, matchedRow, matchedColumn) {
    const groupCol = resolvePrimaryOrderColumnForDedupe(headers);
    let units;
    if (groupCol && normalizeText(String(matchedRow[groupCol] ?? ''))) {
        const g = normalizeText(String(matchedRow[groupCol] ?? ''));
        units = rows.filter((row) => normalizeText(String(row[groupCol] ?? '')) === g);
    } else if (matchedColumn && normalizeText(String(matchedRow[matchedColumn] ?? ''))) {
        const n = normalizeText(String(matchedRow[matchedColumn] ?? ''));
        units = rows.filter((row) => normalizeText(String(row[matchedColumn] ?? '')) === n);
    } else {
        units = [matchedRow];
    }
    return units
        .map((row) => ({ row, index: rows.indexOf(row) }))
        .sort((a, b) => a.index - b.index)
        .map(({ row }) => row);
}

function buildQueueAnalysis(rows, matchedOrder, headers, orderMatchedColumn) {
    const productColumn = resolveColumn(headers, [/^product$/i, /product/i, /model/i, /description/i]);
    const suffixColumn = resolveColumn(headers, [/^au\s*suffix$/i, /\bau\s*suffix\b/i, /^alj\s*suffix$/i, /alj\s*suffix/i, /suffix/i, /trim/i, /grade/i]);
    const dateColumn = resolveReservationCreatedDateColumn(headers);
    const orderColumn = orderMatchedColumn || resolveColumn(headers, [/^order\s*no\.?$/i, /order\s*number/i, /back\s*order\s*number/i]) || resolveOrderColumns(headers)[0] || null;

    const ext1 = resolvePriorityColumn(headers, 'ext', 1);
    const int1 = resolvePriorityColumn(headers, 'int', 1);
    const ext2 = resolvePriorityColumn(headers, 'ext', 2);
    const int2 = resolvePriorityColumn(headers, 'int', 2);
    const ext3 = resolvePriorityColumn(headers, 'ext', 3);
    const int3 = resolvePriorityColumn(headers, 'int', 3);

    const productValue = productColumn ? matchedOrder[productColumn] : '';
    const suffixValue = suffixColumn ? matchedOrder[suffixColumn] : '';
    const ext1Value = ext1 ? matchedOrder[ext1] : '';
    const ext2Value = ext2 ? matchedOrder[ext2] : '';
    const ext3Value = ext3 ? matchedOrder[ext3] : '';
    const int1Value = int1 ? matchedOrder[int1] : '';
    const targetOrder = orderColumn ? matchedOrder[orderColumn] : '';

    const productNorm = normalizeText(productValue);
    const suffixNorm = normalizeText(suffixValue);

    const peerGroup = rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => {
            if (productColumn && normalizeText(row[productColumn]) !== productNorm) return false;
            if (suffixColumn && normalizeText(row[suffixColumn]) !== suffixNorm) return false;
            return true;
        });

    function colorValueMissing(raw) {
        const n = normalizeText(raw);
        return !n || n === '-';
    }

    function colorValueWildcard(raw) {
        return normalizeText(raw) === '*';
    }

    function matchedOrderHasAnyWildcard() {
        const slots = [ext1, ext2, ext3, int1, int2, int3].filter(Boolean);
        return slots.some((col) => colorValueWildcard(matchedOrder[col]));
    }

    /** Int Color 1 is set (not blank or "-"); "*" counts as set. */
    function rowInt1Present(row) {
        if (!int1) return true;
        const ri = normalizeText(row[int1]);
        return !!ri && ri !== '-';
    }

    const tierPairs = [
        { tier: 1, extCol: ext1, intCol: int1 },
        { tier: 2, extCol: ext2, intCol: int2 },
        { tier: 3, extCol: ext3, intCol: int3 }
    ].filter((t) => t.extCol && t.intCol);

    function getRowTierPairs(row) {
        const pairs = [];
        tierPairs.forEach(({ tier, extCol, intCol }) => {
            const extRaw = String(row[extCol] ?? '').trim();
            const intRaw = String(row[intCol] ?? '').trim();
            const extNorm = normalizeText(extRaw);
            const intNorm = normalizeText(intRaw);
            if (!extNorm || extNorm === '*' || extNorm === '-') return;
            if (!intNorm || intNorm === '*' || intNorm === '-') return;
            pairs.push({ tier, extRaw, intRaw, extNorm, intNorm });
        });
        return pairs;
    }

    /**
     * Customer Ext Color 1 value may appear on a peer in Exterior Color 1, 2, or 3.
     * Interior is compared using Interior Color 1 only (same column on each row).
     */
    function rowMatchesLanePeer(row, extNorm, intNorm) {
        if (!rowHasColorInAnyPrioritySlot(row, ext1, ext2, ext3, extNorm)) return false;
        if (!int1) return false;
        return normalizeText(row[int1]) === normalizeText(intNorm);
    }

    /**
     * When the matched order has any "*", each interior lane includes peers with that interior
     * or Int Color 1 "*" (Excel-style: wildcard interior rides in every concrete int queue).
     */
    function rowMatchesLanePeerWithWildcardInt(row, extNorm, intNorm) {
        if (!rowHasColorInAnyPrioritySlot(row, ext1, ext2, ext3, extNorm)) return false;
        if (!int1) return false;
        const ri = normalizeText(row[int1]);
        if (!ri || ri === '-') return false;
        const tn = normalizeText(intNorm);
        return ri === tn || ri === '*';
    }

    function rowMatchesExteriorOnlyPeer(row, extNorm) {
        return rowHasExtInAnyTier(row, extNorm) && rowInt1Present(row);
    }

    function rowHasPairInAnyTier(row, extNorm, intNorm) {
        return rowMatchesLanePeer(row, extNorm, intNorm);
    }

    function rowHasExtInAnyTier(row, extNorm) {
        return rowHasColorInAnyPrioritySlot(row, ext1, ext2, ext3, extNorm);
    }

    function rowHasIntInAnyTier(row, intNorm) {
        if (!int1) return false;
        return normalizeText(row[int1]) === normalizeText(intNorm);
    }

    function computeTierQueue(extCol, intCol, priority) {
        if (!extCol || !intCol) return null;

        const extRaw = matchedOrder[extCol];
        const intRaw = matchedOrder[intCol];

        if (colorValueMissing(extRaw) || colorValueMissing(intRaw)) return null;

        const extWild = colorValueWildcard(extRaw);
        const intWild = colorValueWildcard(intRaw);
        const fixedExt = normalizeText(extRaw);
        const fixedInt = normalizeText(intRaw);

        function rankLane(extNorm, intNorm, bucketLabel) {
            const peers = peerGroup.filter(({ row }) => {
                if (row === matchedOrder) return true;
                return rowHasPairInAnyTier(row, extNorm, intNorm);
            });
            if (!peers.length) return null;
            return {
                position: null,
                queueSize: peers.length,
                bucket: bucketLabel,
                extNorm,
                intNorm
            };
        }

        function rankByExtOnly(extNorm, bucketLabel) {
            const peers = peerGroup.filter(({ row }) => {
                if (row === matchedOrder) return true;
                return rowHasExtInAnyTier(row, extNorm);
            });
            if (!peers.length) return null;
            return { position: null, queueSize: peers.length, bucket: bucketLabel, extNorm, intNorm: null };
        }

        function rankByIntOnly(intNorm, bucketLabel) {
            const peers = peerGroup.filter(({ row }) => {
                if (row === matchedOrder) return true;
                return rowHasIntInAnyTier(row, intNorm);
            });
            if (!peers.length) return null;
            return { position: null, queueSize: peers.length, bucket: bucketLabel, extNorm: null, intNorm };
        }

        function rankByTierOnly(bucketLabel) {
            const peers = peerGroup.filter(({ row }) => {
                if (row === matchedOrder) return true;
                return getRowTierPairs(row).length > 0;
            });
            if (!peers.length) return null;
            return { position: null, queueSize: peers.length, bucket: bucketLabel, extNorm: null, intNorm: null };
        }

        const lanes = [];
        let best = null;

        if (!extWild && !intWild) {
            const lane = rankLane(fixedExt, fixedInt, `Ext ${String(extRaw).trim()} + Int ${String(intRaw).trim()}`);
            if (!lane) return null;
            lanes.push(lane);
            best = lane;
        } else {
            const candidates = new Map();
            peerGroup.forEach(({ row }) => {
                const rowPairs = getRowTierPairs(row);
                rowPairs.forEach((pair) => {
                    if (!extWild && pair.extNorm !== fixedExt) return;
                    if (!intWild && pair.intNorm !== fixedInt) return;
                    const extCandidate = extWild ? pair.extNorm : fixedExt;
                    const intCandidate = intWild ? pair.intNorm : fixedInt;
                    const key = `${extCandidate}|${intCandidate}`;
                    if (!candidates.has(key)) {
                        candidates.set(key, {
                            extNorm: extCandidate,
                            intNorm: intCandidate,
                            label: `Ext ${extWild ? pair.extRaw : String(extRaw).trim()} + Int ${intWild ? pair.intRaw : String(intRaw).trim()}`
                        });
                    }
                });
            });

            candidates.forEach(({ extNorm, intNorm, label }) => {
                const lane = rankLane(extNorm, intNorm, label);
                if (!lane) return;
                lanes.push(lane);
                if (!best || lane.queueSize < best.queueSize) best = lane;
            });
            if (!best) {
                // Wildcard fallback behavior:
                // - Int wildcard: treat as "any int" for fixed ext.
                // - Ext wildcard: treat as "any ext" for fixed int.
                // - Both wildcard: use any valid ext/int rows from this tier.
                if (!extWild && intWild) {
                    const lane = rankByExtOnly(fixedExt, `Ext ${String(extRaw).trim()} + Any Int`);
                    if (lane) {
                        lanes.push(lane);
                        best = lane;
                    }
                } else if (extWild && !intWild) {
                    const lane = rankByIntOnly(fixedInt, `Any Ext + Int ${String(intRaw).trim()}`);
                    if (lane) {
                        lanes.push(lane);
                        best = lane;
                    }
                } else if (extWild && intWild) {
                    const lane = rankByTierOnly('Any Ext + Any Int');
                    if (lane) {
                        lanes.push(lane);
                        best = lane;
                    }
                }
            }
            if (!best) return null;
        }

        const filterExtNorm = best && best.extNorm !== undefined ? best.extNorm : null;
        const filterIntNorm = best && best.intNorm !== undefined ? best.intNorm : null;

        return {
            priority,
            label: `Ext Color 1 + Int Color 1 (same product & suffix; Ext 1 value may appear in Ext 1–3 on each row)`,
            extColumn: extCol,
            intColumn: intCol,
            extValue: extRaw,
            intValue: intRaw,
            queueSize: best.queueSize,
            position: null,
            usedWildcard: extWild || intWild,
            filterExtNorm,
            filterIntNorm,
            lanes: (extWild || intWild) ? lanes : (lanes.length > 1 ? lanes : undefined)
        };
    }

    function fallbackQueue(priority, extCol, intCol) {
        const missingColumns = !extCol || !intCol;
        return {
            priority,
            label: `Ext Color 1 + Int Color 1 (same product & suffix)`,
            extColumn: extCol || null,
            intColumn: intCol || null,
            extValue: extCol ? matchedOrder[extCol] : '',
            intValue: intCol ? matchedOrder[intCol] : '',
            queueSize: 0,
            position: null,
            usedWildcard: false,
            filterExtNorm: null,
            filterIntNorm: null,
            lanes: undefined,
            unavailableReason: missingColumns ? 'Missing Ext/Int priority columns in sheet' : 'No matching rows for this tier'
        };
    }

    const q1 = computeTierQueue(ext1, int1, 1) || fallbackQueue(1, ext1, int1);
    const queueOptions = [q1];

    const primaryQueue = queueOptions[0] || null;
    const qExt2Int1 =
        ext2 && int1 ? computeTierQueue(ext2, int1, 2) || fallbackQueue(2, ext2, int1) : null;
    const qExt3Int1 =
        ext3 && int1 ? computeTierQueue(ext3, int1, 3) || fallbackQueue(3, ext3, int1) : null;

    const custExt1N = normalizeText(ext1Value);
    const custExt2N = normalizeText(ext2Value);
    const custExt3N = normalizeText(ext3Value);
    const custInt1N = normalizeText(int1Value);

    function canUseExteriorInt1DirectFilter(extCol) {
        return (
            extCol &&
            int1 &&
            !colorValueWildcard(matchedOrder[extCol]) &&
            !colorValueWildcard(matchedOrder[int1]) &&
            !colorValueMissing(matchedOrder[extCol]) &&
            !colorValueMissing(matchedOrder[int1])
        );
    }

    const canUseColor1Filter =
        custExt1N && custInt1N && canUseExteriorInt1DirectFilter(ext1);
    const canUseColor2Filter =
        custExt2N && custInt1N && canUseExteriorInt1DirectFilter(ext2);
    const canUseColor3Filter =
        custExt3N && custInt1N && canUseExteriorInt1DirectFilter(ext3);

    function matchingPeerItemsForExteriorInt1(tierPrimaryQueue, canUseDirectFilter, custExtNormForDirect) {
        if (canUseDirectFilter) {
            return peerGroup.filter(({ row }) => rowMatchesLanePeer(row, custExtNormForDirect, custInt1N));
        }
        // Matched order has "*": rank by exterior; peers must have Int Color 1 set (incl. "*"), not blank.
        if (
            int1 &&
            matchedOrderHasAnyWildcard() &&
            colorValueWildcard(matchedOrder[int1]) &&
            custExtNormForDirect &&
            custExtNormForDirect !== '' &&
            custExtNormForDirect !== '-' &&
            custExtNormForDirect !== '*'
        ) {
            return peerGroup.filter(({ row }) => rowMatchesExteriorOnlyPeer(row, custExtNormForDirect));
        }
        const pq = tierPrimaryQueue;
        if (
            pq &&
            pq.filterExtNorm != null &&
            pq.filterExtNorm !== '' &&
            pq.filterIntNorm != null &&
            pq.filterIntNorm !== ''
        ) {
            return peerGroup.filter(({ row }) =>
                rowMatchesLanePeer(row, pq.filterExtNorm, pq.filterIntNorm)
            );
        }
        if (
            pq &&
            pq.filterExtNorm != null &&
            pq.filterExtNorm !== '' &&
            pq.filterIntNorm == null
        ) {
            return peerGroup.filter(({ row }) => rowHasExtInAnyTier(row, pq.filterExtNorm));
        }
        if (
            pq &&
            pq.filterExtNorm == null &&
            pq.filterIntNorm != null &&
            pq.filterIntNorm !== ''
        ) {
            return peerGroup.filter(({ row }) => rowHasIntInAnyTier(row, pq.filterIntNorm));
        }
        return peerGroup;
    }

    const sortedColor1PeerItems = sortPeersByReservationDate(
        matchingPeerItemsForExteriorInt1(primaryQueue, canUseColor1Filter, custExt1N),
        dateColumn,
        orderColumn
    );
    const position0InColor1Queue = sortedColor1PeerItems.findIndex(({ row }) => row === matchedOrder);
    const position1InColor1Queue = position0InColor1Queue >= 0 ? position0InColor1Queue + 1 : null;

    const queueRows = sortedColor1PeerItems
        .map((item) => item.row)
        .slice(0, canUseColor1Filter ? undefined : 100);

    const sortedColor2PeerItems =
        ext2 && int1
            ? sortPeersByReservationDate(
                  matchingPeerItemsForExteriorInt1(qExt2Int1, canUseColor2Filter, custExt2N),
                  dateColumn,
                  orderColumn
              )
            : [];
    const position0InColor2Queue = sortedColor2PeerItems.findIndex(({ row }) => row === matchedOrder);
    const position1InColor2Queue = position0InColor2Queue >= 0 ? position0InColor2Queue + 1 : null;

    const sortedColor3PeerItems =
        ext3 && int1
            ? sortPeersByReservationDate(
                  matchingPeerItemsForExteriorInt1(qExt3Int1, canUseColor3Filter, custExt3N),
                  dateColumn,
                  orderColumn
              )
            : [];
    const position0InColor3Queue = sortedColor3PeerItems.findIndex(({ row }) => row === matchedOrder);
    const position1InColor3Queue = position0InColor3Queue >= 0 ? position0InColor3Queue + 1 : null;

    /**
     * When the matched order has any "*", list one sub-queue per concrete interior seen among peers
     * sharing this tier's exterior (in Ext 1–3). Each lane includes Int Color 1 = that code OR "*".
     */
    function buildInteriorVariantQueuesIfWildcardInt(extRawForTier) {
        if (!int1 || !matchedOrderHasAnyWildcard()) return null;
        if (!colorValueWildcard(matchedOrder[int1])) return null;
        const en = normalizeText(String(extRawForTier ?? ''));
        if (!en || en === '-' || en === '*') return null;

        const extPeerItems = peerGroup.filter(({ row }) => rowHasExtInAnyTier(row, en));
        const intNormToLabel = new Map();
        extPeerItems.forEach(({ row }) => {
            const raw = String(row[int1] ?? '').trim();
            const n = normalizeText(raw);
            if (!n || n === '-' || n === '*') return;
            if (!intNormToLabel.has(n)) intNormToLabel.set(n, raw || n);
        });
        if (intNormToLabel.size === 0) return [];

        const laneMatcher = (row, intNorm) =>
            rowMatchesLanePeerWithWildcardInt(row, en, intNorm);

        const variants = [];
        intNormToLabel.forEach((intLabel, intNorm) => {
            const items = peerGroup.filter(({ row }) => laneMatcher(row, intNorm));
            const sorted = sortPeersByReservationDate(items, dateColumn, orderColumn);
            const pos0 = sorted.findIndex(({ row }) => row === matchedOrder);
            variants.push({
                interiorColor: intLabel,
                interiorNorm: intNorm,
                total: sorted.length,
                position: pos0 >= 0 ? pos0 + 1 : null
            });
        });
        variants.sort((a, b) => {
            if (a.total !== b.total) return a.total - b.total;
            return compareOrderNumberValues(a.interiorColor, b.interiorColor);
        });
        return variants;
    }

    /** Orders in the exterior-only queue not covered by any per-interior lane (incl. "*" lanes). */
    function buildExteriorOnlyGapOrders(extRawForTier, interiorVariants) {
        if (!int1 || !Array.isArray(interiorVariants)) return null;
        const en = normalizeText(String(extRawForTier ?? ''));
        if (!en || en === '-' || en === '*') return [];

        const listedIntNorms = new Set(
            interiorVariants.map((v) => normalizeText(v.interiorNorm)).filter(Boolean)
        );
        const extOnlyItems = peerGroup.filter(({ row }) => rowMatchesExteriorOnlyPeer(row, en));
        const gap = [];

        extOnlyItems.forEach(({ row }) => {
            const rawInt = String(row[int1] ?? '').trim();
            const intNorm = normalizeText(rawInt);
            const inVariantLane =
                intNorm === '*' ||
                (intNorm && intNorm !== '-' && listedIntNorms.has(intNorm));
            if (inVariantLane) return;

            const ordRaw = orderColumn ? row[orderColumn] : '';
            const ord = String(ordRaw ?? '').trim();
            gap.push({
                orderNumber: ord || null,
                interiorColor1: rawInt || null,
                isMatchedOrder: row === matchedOrder
            });
        });

        gap.sort((a, b) => {
            if (a.isMatchedOrder !== b.isMatchedOrder) return a.isMatchedOrder ? 1 : -1;
            return compareOrderNumberValues(a.orderNumber, b.orderNumber);
        });
        return gap;
    }

    const interiorVariants1 = ext1 && int1 ? buildInteriorVariantQueuesIfWildcardInt(ext1Value) : null;
    const interiorVariants2 = ext2 && int1 ? buildInteriorVariantQueuesIfWildcardInt(ext2Value) : null;
    const interiorVariants3 = ext3 && int1 ? buildInteriorVariantQueuesIfWildcardInt(ext3Value) : null;

    const exteriorOnlyGapOrders1 =
        interiorVariants1 != null ? buildExteriorOnlyGapOrders(ext1Value, interiorVariants1) : null;
    const exteriorOnlyGapOrders2 =
        interiorVariants2 != null ? buildExteriorOnlyGapOrders(ext2Value, interiorVariants2) : null;
    const exteriorOnlyGapOrders3 =
        interiorVariants3 != null ? buildExteriorOnlyGapOrders(ext3Value, interiorVariants3) : null;

    const customerColor1Queue =
        ext1 && int1
            ? {
                  total: sortedColor1PeerItems.length,
                  position: position1InColor1Queue,
                  exteriorColor1: ext1Value,
                  interiorColor1: int1Value,
                  product: productValue,
                  suffix: suffixValue,
                  ...(interiorVariants1 != null ? { interiorVariantQueues: interiorVariants1 } : {}),
                  ...(exteriorOnlyGapOrders1 != null ? { exteriorOnlyGapOrders: exteriorOnlyGapOrders1 } : {})
              }
            : null;

    const customerColor2Queue =
        ext2 && int1 && !colorValueMissing(ext2Value)
            ? {
                  total: sortedColor2PeerItems.length,
                  position: position1InColor2Queue,
                  exteriorColor2: ext2Value,
                  interiorColor1: int1Value,
                  product: productValue,
                  suffix: suffixValue,
                  ...(interiorVariants2 != null ? { interiorVariantQueues: interiorVariants2 } : {}),
                  ...(exteriorOnlyGapOrders2 != null ? { exteriorOnlyGapOrders: exteriorOnlyGapOrders2 } : {})
              }
            : null;

    const customerColor3Queue =
        ext3 && int1 && !colorValueMissing(ext3Value)
            ? {
                  total: sortedColor3PeerItems.length,
                  position: position1InColor3Queue,
                  exteriorColor3: ext3Value,
                  interiorColor1: int1Value,
                  product: productValue,
                  suffix: suffixValue,
                  ...(interiorVariants3 != null ? { interiorVariantQueues: interiorVariants3 } : {}),
                  ...(exteriorOnlyGapOrders3 != null ? { exteriorOnlyGapOrders: exteriorOnlyGapOrders3 } : {})
              }
            : null;

    const dateCounts = new Map();
    if (dateColumn) {
        queueRows.forEach((row) => {
            const key = String(row[dateColumn] ?? '').trim() || '(No Date)';
            dateCounts.set(key, (dateCounts.get(key) || 0) + 1);
        });
    }

    const suggestionColumnsReady = !!(productColumn && suffixColumn && ext1 && int1);
    const matchedSuffixNorm = normalizeText(suffixValue);
    const matchedExt1Norm = normalizeText(ext1Value);
    const matchedInt1Norm = normalizeText(int1Value);
    const productRows = rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => (productColumn ? normalizeText(row[productColumn]) === productNorm : true));
    const suggestionMap = new Map();
    if (suggestionColumnsReady) {
        productRows.forEach(({ row, index }) => {
            const sRaw = String(row[suffixColumn] ?? '').trim();
            const eRaw = String(row[ext1] ?? '').trim();
            const iRaw = String(row[int1] ?? '').trim();
            const sNorm = normalizeText(sRaw);
            const eNorm = normalizeText(eRaw);
            const iNorm = normalizeText(iRaw);
            if (!sNorm || !eNorm || !iNorm) return;
            if (eNorm === '-' || eNorm === '*' || iNorm === '-' || iNorm === '*') return;
            if (sNorm === matchedSuffixNorm && eNorm === matchedExt1Norm && iNorm === matchedInt1Norm) return;
            const key = `${sNorm}|${eNorm}|${iNorm}`;
            if (!suggestionMap.has(key)) {
                suggestionMap.set(key, {
                    suffix: sRaw,
                    extColor1: eRaw,
                    intColor1: iRaw,
                    members: []
                });
            }
            suggestionMap.get(key).members.push({ row, index });
        });
    }
    const suggestedOptions = Array.from(suggestionMap.values())
        .map((opt) => {
            const sortedMembers = sortPeersByReservationDate(opt.members, dateColumn, orderColumn);
            const queueSize = sortedMembers.length;
            let estimatedRank = null;
            if (dateColumn) {
                let strictlyBefore = 0;
                sortedMembers.forEach(({ row }) => {
                    if (compareReservationPriority(row, matchedOrder, dateColumn, orderColumn) < 0) strictlyBefore += 1;
                });
                estimatedRank = strictlyBefore + 1; // 1-based for UI consistency.
            }
            const topDateRaw = queueSize && dateColumn ? sortedMembers[0].row[dateColumn] : null;
            return {
                suffix: opt.suffix,
                extColor1: opt.extColor1,
                intColor1: opt.intColor1,
                queueSize,
                estimatedRank,
                oldestReservationCreated: topDateRaw ?? null,
                oldestOrderDate: topDateRaw ?? null
            };
        })
        .sort((a, b) => {
            const ra = a.estimatedRank ?? Number.MAX_SAFE_INTEGER;
            const rb = b.estimatedRank ?? Number.MAX_SAFE_INTEGER;
            if (ra !== rb) return ra - rb;
            return a.queueSize - b.queueSize;
        })
        .slice(0, 8);

    const queueRule =
        'Same product and suffix. For each exterior priority (1–3), that exterior is matched if it appears in Exterior Color 1, 2, or 3 on each row; interior always uses Interior Color 1 only. Cards show position after sorting by reservation date (earliest first), then order number when dates tie. Wildcard Ext/Int on the order uses the same lane resolution as the lookup.';

    // If the matched order has any "*" in its Ext/Int tiers, build a full
    // queue matrix (cross-product of every distinct ext × int present in BO
    // under the same Product+Suffix) so the operator can suggest the
    // shortest queue available to the customer.
    const orderHasWildcard = tierPairs.some(({ extCol, intCol }) =>
        colorValueWildcard(matchedOrder[extCol]) || colorValueWildcard(matchedOrder[intCol])
    );

    let queueMatrix = null;
    if (orderHasWildcard && productColumn && suffixColumn && dateColumn && tierPairs.length) {
        const productSuffixRows = peerGroup.map(({ row }) => row);
        const extCols = tierPairs.map((t) => t.extCol);
        const intCols = tierPairs.map((t) => t.intCol);

        function collectDistinctValues(cols) {
            const seen = new Map();
            productSuffixRows.forEach((row) => {
                cols.forEach((col) => {
                    if (!col) return;
                    const raw = String(row[col] ?? '').trim();
                    const norm = normalizeText(raw);
                    if (!norm || norm === '-' || norm === '*') return;
                    if (!seen.has(norm)) seen.set(norm, raw);
                });
            });
            return seen;
        }

        const extMap = collectDistinctValues(extCols);
        const intMap = collectDistinctValues(intCols);

        function queueForPair(extNorm, intNorm) {
            const peers = productSuffixRows.filter((row) => rowHasPairInAnyTier(row, extNorm, intNorm));
            return {
                matchingTotal: peers.length
            };
        }

        const possibilities = [];
        extMap.forEach((extLabel, extNorm) => {
            intMap.forEach((intLabel, intNorm) => {
                const q = queueForPair(extNorm, intNorm);
                possibilities.push({
                    exteriorColor: extLabel,
                    interiorColor: intLabel,
                    matchingTotal: q.matchingTotal
                });
            });
        });
        possibilities.sort((a, b) => a.matchingTotal - b.matchingTotal);

        const totalCustomersInQueues = possibilities.reduce(
            (sum, p) => sum + (p.matchingTotal || 0),
            0
        );
        const lightest = possibilities[0] || null;

        queueMatrix = {
            possibilities,
            summary: {
                totalQueues: possibilities.length,
                totalCustomersInQueues,
                distinctExteriors: extMap.size,
                distinctInteriors: intMap.size,
                lightestSuggestion: lightest
                    ? {
                          exteriorColor: lightest.exteriorColor,
                          interiorColor: lightest.interiorColor,
                          matchingTotal: lightest.matchingTotal
                      }
                    : null
            },
            rule: 'Order has wildcard(s); each row shows how many reservations match that Ext/Int (Ext searched in Ext 1–3, Int compared on Int Color 1 only).'
        };
    }

    return {
        columns: {
            orderColumn,
            productColumn,
            suffixColumn,
            dateColumn,
            extColorPriority1: ext1,
            interiorColorPriority1: int1,
            extColorPriority2: ext2,
            interiorColorPriority2: int2,
            extColorPriority3: ext3,
            interiorColorPriority3: int3
        },
        values: {
            orderNumber: targetOrder,
            product: productValue,
            suffix: suffixValue,
            extColor1: ext1Value,
            intColor1: int1Value,
            extColor2: ext2 ? matchedOrder[ext2] : '',
            intColor2: int2 ? matchedOrder[int2] : '',
            extColor3: ext3 ? matchedOrder[ext3] : '',
            intColor3: int3 ? matchedOrder[int3] : ''
        },
        queueSize: primaryQueue ? primaryQueue.queueSize : 0,
        position: null,
        bestPosition: null,
        customerColor1Queue,
        customerColor2Queue,
        customerColor3Queue,
        queueOptions,
        queueMatrix,
        suggestedOptions,
        queueRule,
        orderDates: Array.from(dateCounts.entries()).map(([date, count]) => ({ date, count })),
        queuePreview: queueRows.slice(0, 100)
    };
}

function getBoLocalDateKey() {
    return new Date().toLocaleDateString('en-CA');
}

function recordBoOrderSearch(orderNumber) {
    const key = String(orderNumber ?? '').trim();
    if (!key) return;
    const today = getBoLocalDateKey();
    let stats = { date: today, orderCounts: {} };
    try {
        if (fs.existsSync(BO_LOOKUP_STATS_FILE)) {
            const raw = JSON.parse(fs.readFileSync(BO_LOOKUP_STATS_FILE, 'utf8'));
            if (raw && raw.date === today && raw.orderCounts && typeof raw.orderCounts === 'object') {
                stats = { date: today, orderCounts: { ...raw.orderCounts } };
            }
        }
    } catch (e) {
        /* invalid file: start fresh for today */
    }
    if (stats.date !== today) {
        stats = { date: today, orderCounts: {} };
    }
    stats.orderCounts[key] = (stats.orderCounts[key] || 0) + 1;
    try {
        fs.writeFileSync(BO_LOOKUP_STATS_FILE, JSON.stringify(stats, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to write BO lookup stats:', e);
    }
}

function aggregateBoProductCounts(rows, headers) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const productColumn = resolveColumn(headers, [/^product$/i, /product/i, /model/i, /description/i]);
    if (!productColumn) return [];
    const counts = new Map();
    rows.forEach((row) => {
        const p = String(row[productColumn] ?? '').trim();
        const label = p || '(blank)';
        counts.set(label, (counts.get(label) || 0) + 1);
    });
    return Array.from(counts.entries())
        .map(([product, count]) => ({ product, count }))
        .sort((a, b) => b.count - a.count || String(a.product).localeCompare(String(b.product)));
}

// Upload BO data Excel daily (admin only, accepts base64 data URL)
app.post('/api/bo-data/upload', authenticateBackend, express.json({ limit: '100mb' }), (req, res) => {
    try {
        const { fileData, filename } = req.body;
        if (!fileData) {
            return res.status(400).json({ error: 'fileData is required' });
        }

        const base64Data = fileData.startsWith('data:') ? fileData.split(',')[1] : fileData;
        const fileBuffer = Buffer.from(base64Data, 'base64');
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });

        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
            return res.status(400).json({ error: 'Excel file has no sheets' });
        }

        // BO lookup uses the first sheet only (skip Fleet and any other sheets).
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) {
            return res.status(400).json({ error: 'First sheet is empty or unreadable' });
        }

        const parsedSheet = parseSheetWithDetectedHeader(worksheet);
        const rows = (parsedSheet.rows || []).map((row) => ({ ...row, __sourceSheet: sheetName }));
        const headersSet = new Set();
        rows.forEach((row) => Object.keys(row).forEach((key) => headersSet.add(key)));
        const headers = Array.from(headersSet);
        const uniqueSheets = [sheetName];
        const sheetStats = [{ sheetName, rowCount: rows.length }];

        const payload = {
            uploadedAt: new Date().toISOString(),
            filename: filename || 'bo-data.xlsx',
            sheetName,
            sheets: sheetStats,
            headers,
            rowCount: rows.length,
            rows
        };

        fs.writeFileSync(BO_DATA_FILE, JSON.stringify(payload, null, 2), 'utf8');
        const skipped = workbook.SheetNames.slice(1);
        res.json({
            success: true,
            message: `BO data uploaded: first sheet "${sheetName}", ${payload.rowCount} rows.`,
            meta: {
                filename: payload.filename,
                sheetName: payload.sheetName,
                sheets: payload.sheets,
                rowCount: payload.rowCount,
                uploadedAt: payload.uploadedAt,
                mergedSheets: uniqueSheets,
                skippedSheets: skipped
            }
        });
    } catch (error) {
        console.error('Error uploading BO data Excel:', error);
        res.status(500).json({ error: 'Failed to upload BO data: ' + error.message });
    }
});

// BO data meta for UI checks
app.get('/api/bo-data/meta', (req, res) => {
    try {
        if (!fs.existsSync(BO_DATA_FILE)) {
            return res.json({ exists: false });
        }
        const data = JSON.parse(fs.readFileSync(BO_DATA_FILE, 'utf8'));
        res.json({
            exists: true,
            filename: data.filename || '',
            sheetName: data.sheetName || '',
            sheets: data.sheets || [],
            rowCount: data.rowCount || 0,
            uploadedAt: data.uploadedAt || ''
        });
    } catch (error) {
        console.error('Error reading BO data meta:', error);
        res.status(500).json({ error: 'Failed to read BO data meta' });
    }
});

// BO data preview rows for admin page
app.get('/api/bo-data/preview', (req, res) => {
    try {
        if (!fs.existsSync(BO_DATA_FILE)) {
            return res.status(404).json({ error: 'No BO data uploaded yet' });
        }
        const data = JSON.parse(fs.readFileSync(BO_DATA_FILE, 'utf8'));
        const rows = Array.isArray(data.rows) ? data.rows : [];
        const headers = Array.isArray(data.headers) ? data.headers : [];
        const requestedLimit = parseInt(req.query.limit, 10);
        const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 500)) : 200;
        const previewRows = rows.slice(0, limit);

        res.json({
            filename: data.filename || '',
            sheetName: data.sheetName || '',
            rowCount: rows.length,
            headers,
            previewCount: previewRows.length,
            rows: previewRows
        });
    } catch (error) {
        console.error('Error reading BO data preview:', error);
        res.status(500).json({ error: 'Failed to read BO data preview' });
    }
});

// BO data taxonomy: products -> suffixes -> distinct exterior/interior colors.
// Powers the cascading "For new customers" picker on the lookup page.
app.get('/api/bo-data/taxonomy', (req, res) => {
    try {
        if (!fs.existsSync(BO_DATA_FILE)) {
            return res.status(404).json({ error: 'No BO data uploaded yet' });
        }
        const data = JSON.parse(fs.readFileSync(BO_DATA_FILE, 'utf8'));
        const lookup = BoOrderLookup.fromBoData(data);
        res.json(lookup.buildTaxonomy({
            uploadedAt: data.uploadedAt,
            filename: data.filename,
            sheetName: data.sheetName
        }));
    } catch (error) {
        console.error('Error building BO taxonomy:', error);
        res.status(500).json({ error: 'Failed to build BO taxonomy: ' + error.message });
    }
});

// Lookup order number from latest uploaded BO data
app.get('/api/bo-data/order/:orderNumber', (req, res) => {
    try {
        if (!fs.existsSync(BO_DATA_FILE)) {
            return res.status(404).json({ error: 'No BO data uploaded yet' });
        }

        const orderNumber = String(req.params.orderNumber || '').trim();
        if (!orderNumber) {
            return res.status(400).json({ error: 'Order number is required' });
        }

        const data = JSON.parse(fs.readFileSync(BO_DATA_FILE, 'utf8'));
        const lookup = BoOrderLookup.fromBoData(data);
        const result = lookup.lookupOrder(orderNumber);
        if (!result) {
            return res.status(404).json({ error: 'Order number not found' });
        }

        recordBoOrderSearch(orderNumber);

        res.json({
            ...result,
            source: {
                filename: data.filename || '',
                sheetName: data.sheetName || '',
                sheets: data.sheets || [],
                uploadedAt: data.uploadedAt || ''
            }
        });
    } catch (error) {
        console.error('Error looking up BO order:', error);
        res.status(500).json({ error: 'Failed to lookup order: ' + error.message });
    }
});

// Admin: today's order lookup counts + product totals from latest BO file (password required)
app.get('/api/bo-data/admin-stats', (req, res) => {
    try {
        const password = req.query?.password;
        if (password !== BACKEND_PASSWORD) {
            return res.status(401).json({ error: 'Unauthorized: Invalid password' });
        }

        const today = getBoLocalDateKey();
        let searchesToday = [];
        try {
            if (fs.existsSync(BO_LOOKUP_STATS_FILE)) {
                const s = JSON.parse(fs.readFileSync(BO_LOOKUP_STATS_FILE, 'utf8'));
                if (s && s.date === today && s.orderCounts && typeof s.orderCounts === 'object') {
                    searchesToday = Object.entries(s.orderCounts)
                        .map(([orderNumber, count]) => ({ orderNumber, count: Number(count) || 0 }))
                        .filter((x) => x.count > 0)
                        .sort((a, b) => b.count - a.count || String(a.orderNumber).localeCompare(String(b.orderNumber), undefined, { numeric: true }));
                }
            }
        } catch (e) {
            console.error('Error reading BO lookup stats:', e);
        }

        let productTotals = [];
        let totalRows = 0;
        if (fs.existsSync(BO_DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(BO_DATA_FILE, 'utf8'));
            const boRows = Array.isArray(data.rows) ? data.rows : [];
            const boHeaders = Array.isArray(data.headers) ? data.headers : [];
            totalRows = boRows.length;
            productTotals = BoOrderLookup.fromBoData({ rows: boRows, headers: boHeaders })
                .aggregateBoProductCounts(boRows, boHeaders);
        }

        res.json({
            date: today,
            searchesToday,
            productTotals,
            totalRows
        });
    } catch (error) {
        console.error('Error building BO admin stats:', error);
        res.status(500).json({ error: 'Failed to load admin stats: ' + error.message });
    }
});

// All Product × Suffix × Ext × Int queue sizes from latest BO upload
app.get('/api/bo-data/queue-combinations', (req, res) => {
    try {
        if (!fs.existsSync(BO_DATA_FILE)) {
            return res.status(404).json({ error: 'No BO data uploaded yet' });
        }
        const data = JSON.parse(fs.readFileSync(BO_DATA_FILE, 'utf8'));
        const lookup = BoOrderLookup.fromBoData(data);
        res.json({
            ...lookup.buildAllQueueCombinations(),
            source: {
                filename: data.filename || '',
                sheetName: data.sheetName || '',
                uploadedAt: data.uploadedAt || ''
            }
        });
    } catch (error) {
        console.error('Error building queue combinations:', error);
        res.status(500).json({ error: 'Failed to build queue combinations: ' + error.message });
    }
});

// Admin helper: estimate queue number for a new customer by Product+Suffix+Ext/Int pair.
app.get('/api/bo-data/new-customer-queue', (req, res) => {
    try {
        if (!fs.existsSync(BO_DATA_FILE)) {
            return res.status(404).json({ error: 'No BO data uploaded yet' });
        }

        const productInput = String(req.query?.product || '').trim();
        const suffixInput = String(req.query?.suffix || '').trim();
        const extInput = String(req.query?.exteriorColor || '').trim();
        const intInput = String(req.query?.interiorColor || '').trim();
        const orderDateInput = String(req.query?.orderDate || '').trim();

        if (!productInput || !suffixInput || !extInput || !intInput) {
            return res.status(400).json({ error: 'product, suffix, exteriorColor, and interiorColor are required' });
        }

        const data = JSON.parse(fs.readFileSync(BO_DATA_FILE, 'utf8'));
        const lookup = BoOrderLookup.fromBoData(data);
        res.json(lookup.computeNewCustomerQueue({
            product: productInput,
            suffix: suffixInput,
            exteriorColor: extInput,
            interiorColor: intInput,
            orderDate: orderDateInput
        }));
    } catch (error) {
        console.error('Error computing new customer queue:', error);
        res.status(500).json({ error: 'Failed to compute new customer queue: ' + error.message });
    }
});

app.post('/api/banks', authenticateBackend, (req, res) => {
    const { banks } = req.body;
    
    try {
        const existingData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        const data = { ...existingData, banks };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        
        // Broadcast update to all connected clients
        broadcastUpdate();
        
        res.json({ success: true, message: 'Bank settings updated successfully' });
    } catch (error) {
        console.error('Error saving banks data:', error);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

// Update car settings (admin only)
app.post('/api/cars', authenticateBackend, (req, res) => {
    const { cars } = req.body;
    
    try {
        const existingData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        const data = { ...existingData, cars };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        
        // Broadcast update to all connected clients
        broadcastUpdate();
        
        res.json({ success: true, message: 'Car settings updated successfully' });
    } catch (error) {
        console.error('Error saving cars data:', error);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

// Directory for saving Excel exports
const EXPORTS_DIR = path.join(__dirname, 'saved-exports');
if (!fs.existsSync(EXPORTS_DIR)) {
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

// API endpoint to save Excel file (accepts base64 data)
app.post('/api/save-export', authenticateBackend, express.json({ limit: '100mb' }), (req, res) => {
    try {
        const { filename, fileData, metadata } = req.body;
        
        if (!fileData) {
            return res.status(400).json({ error: 'File data is required' });
        }
        
        // Generate filename with timestamp if not provided
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
        const finalFilename = filename || `export_${timestamp}.xlsx`;
        const filePath = path.join(EXPORTS_DIR, finalFilename);
        
        // Handle base64 encoded file
        let fileBuffer;
        if (fileData.startsWith('data:')) {
            // Remove data URL prefix
            const base64Data = fileData.split(',')[1];
            fileBuffer = Buffer.from(base64Data, 'base64');
        } else {
            // Assume it's already base64 without prefix
            fileBuffer = Buffer.from(fileData, 'base64');
        }
        
        // Save file
        fs.writeFileSync(filePath, fileBuffer);
        
        // Save metadata if provided
        const metadataFile = path.join(EXPORTS_DIR, `${finalFilename}.metadata.json`);
        if (metadata) {
            fs.writeFileSync(metadataFile, JSON.stringify({
                ...metadata,
                savedAt: new Date().toISOString(),
                filename: finalFilename
            }, null, 2));
        }
        
        res.json({ 
            success: true, 
            message: 'File saved successfully',
            filename: finalFilename,
            savedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error saving export file:', error);
        res.status(500).json({ error: 'Failed to save file: ' + error.message });
    }
});

// API endpoint to list saved exports
app.get('/api/saved-exports', authenticateBackend, (req, res) => {
    try {
        const files = fs.readdirSync(EXPORTS_DIR)
            .filter(file => file.endsWith('.xlsx') || file.endsWith('.xls'))
            .map(file => {
                const filePath = path.join(EXPORTS_DIR, file);
                const stats = fs.statSync(filePath);
                const metadataPath = path.join(EXPORTS_DIR, `${file}.metadata.json`);
                let metadata = {};
                if (fs.existsSync(metadataPath)) {
                    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
                }
                
                return {
                    filename: file,
                    size: stats.size,
                    created: stats.birthtime.toISOString(),
                    modified: stats.mtime.toISOString(),
                    ...metadata
                };
            })
            .sort((a, b) => new Date(b.created) - new Date(a.created)); // Sort by newest first
        
        res.json({ success: true, files });
    } catch (error) {
        console.error('Error listing exports:', error);
        res.status(500).json({ error: 'Failed to list files: ' + error.message });
    }
});

// API endpoint to get a saved export file
app.get('/api/saved-exports/:filename', authenticateBackend, (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(EXPORTS_DIR, filename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        // Check if it's a request for metadata
        if (req.query.metadata === 'true') {
            const metadataPath = path.join(EXPORTS_DIR, `${filename}.metadata.json`);
            if (fs.existsSync(metadataPath)) {
                const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
                return res.json({ success: true, metadata });
            }
            return res.json({ success: true, metadata: null });
        }
        
        // Send the file
        res.sendFile(filePath);
    } catch (error) {
        console.error('Error retrieving export file:', error);
        res.status(500).json({ error: 'Failed to retrieve file: ' + error.message });
    }
});

// API endpoint to delete a saved export
app.delete('/api/saved-exports/:filename', authenticateBackend, (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(EXPORTS_DIR, filename);
        const metadataPath = path.join(EXPORTS_DIR, `${filename}.metadata.json`);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        fs.unlinkSync(filePath);
        if (fs.existsSync(metadataPath)) {
            fs.unlinkSync(metadataPath);
        }
        
        res.json({ success: true, message: 'File deleted successfully' });
    } catch (error) {
        console.error('Error deleting export file:', error);
        res.status(500).json({ error: 'Failed to delete file: ' + error.message });
    }
});

// ─── Showroom Flight Board ───────────────────────────────────────────────────
const SHOWROOM_BOARD_FILE = path.join(__dirname, 'showroom-board-data.json');
const SHOWROOM_PARKING_SLOTS = 10;
const SHOWROOM_DELAYED_ZONE_SLOTS = [8, 9, 10];
const SHOWROOM_ROLE_PASSWORDS = {
    uploader: '1234',
    controller: '1234',
    security: '1234'
};

let broadcastShowroomUpdate = () => {};

function loadShowroomBoardStore() {
    const empty = {
        salesRaw: { uploadedAt: null, sheetName: null, filename: null, rows: [] },
        leadsInProgress: { uploadedAt: null, sheetName: null, filename: null, rows: [] },
        vinLinks: [],
        showroomVins: [],
        parkingSlots: [],
        parkingQueue: [],
        arrivedCars: [],
        parkingRecords: [],
        vehicles: [],
        updatedAt: null
    };
    try {
        if (fs.existsSync(SHOWROOM_BOARD_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(SHOWROOM_BOARD_FILE, 'utf8'));
            if (parsed.salesRaw || parsed.vinLinks) {
                const store = {
                    ...empty,
                    ...parsed,
                    salesRaw: { ...empty.salesRaw, ...(parsed.salesRaw || {}) },
                    leadsInProgress: { ...empty.leadsInProgress, ...(parsed.leadsInProgress || {}) },
                    vinLinks: Array.isArray(parsed.vinLinks) ? parsed.vinLinks : [],
                    showroomVins: Array.isArray(parsed.showroomVins) ? parsed.showroomVins : [],
                    parkingSlots: Array.isArray(parsed.parkingSlots) ? parsed.parkingSlots : [],
                    parkingQueue: Array.isArray(parsed.parkingQueue) ? parsed.parkingQueue : [],
                    arrivedCars: Array.isArray(parsed.arrivedCars) ? parsed.arrivedCars : [],
                    parkingRecords: Array.isArray(parsed.parkingRecords) ? parsed.parkingRecords : [],
                    vehicles: Array.isArray(parsed.vehicles) ? parsed.vehicles : []
                };
                return finalizeShowroomBoardLoad(store);
            }
            if (Array.isArray(parsed.vehicles)) {
                const store = { ...empty, vehicles: parsed.vehicles, updatedAt: parsed.updatedAt || null };
                return finalizeShowroomBoardLoad(store);
            }
        }
    } catch (e) {
        console.error('Showroom board load error:', e.message);
    }
    const store = { ...empty };
    return finalizeShowroomBoardLoad(store);
}

function finalizeShowroomBoardLoad(store) {
    initShowroomParkingSlots(store);
    if (migrateParkingSlotTimezones(store)) {
        saveShowroomBoardStore(store);
    }
    return store;
}

function saveShowroomBoardStore(store) {
    initShowroomParkingSlots(store);
    store.updatedAt = new Date().toISOString();
    fs.writeFileSync(SHOWROOM_BOARD_FILE, JSON.stringify(store, null, 2));
}

function initShowroomParkingSlots(store) {
    const existing = Array.isArray(store.parkingSlots) ? store.parkingSlots : [];
    const bySlot = new Map(existing.map((s) => [Number(s.slot), s]));
    store.parkingSlots = Array.from({ length: SHOWROOM_PARKING_SLOTS }, (_, i) => {
        const slot = i + 1;
        const prev = bySlot.get(slot) || {};
        return {
            slot,
            showroomVin: prev.showroomVin ? String(prev.showroomVin).trim().toUpperCase() : null,
            replacementVin: prev.replacementVin ? String(prev.replacementVin).trim().toUpperCase() : null,
            showroomIstimaraIssuedDate: prev.showroomIstimaraIssuedDate || prev.istimaraIssuedDate || null,
            deliveryAppointmentTime: prev.deliveryAppointmentTime || null,
            departureTime: prev.departureTime || null,
            expectedReplacementArrival: prev.expectedReplacementArrival || null,
            deliveryDelayed: Boolean(prev.deliveryDelayed),
            awaitingDeliveryConfirm: Boolean(prev.awaitingDeliveryConfirm),
            deliveryReminderSent: Boolean(prev.deliveryReminderSent),
            prepReminderSent: Boolean(prev.prepReminderSent),
            timezoneMigrated: Boolean(prev.timezoneMigrated),
            originSlot: prev.originSlot ? Number(prev.originSlot) : null,
            controllerStatus: prev.controllerStatus || null,
            checklistCarArrived: Boolean(prev.checklistCarArrived),
            checklistNotDamaged: Boolean(prev.checklistNotDamaged),
            checklistWashed: Boolean(prev.checklistWashed),
            checklistStickersRemoved: Boolean(prev.checklistStickersRemoved),
            checklistPlated: Boolean(prev.checklistPlated),
            securityEntranceAt: prev.securityEntranceAt || null,
            securityNotDamaged: prev.securityNotDamaged ?? null,
            securityDamaged: Boolean(prev.securityDamaged),
            securityIstimaraVerified: Boolean(prev.securityIstimaraVerified),
            securityIstimaraVerifiedAt: prev.securityIstimaraVerifiedAt || null,
            updatedAt: prev.updatedAt || null
        };
    });
    if (!Array.isArray(store.parkingQueue)) store.parkingQueue = [];
    if (!Array.isArray(store.arrivedCars)) store.arrivedCars = [];
}

const SHOWROOM_DELIVERY_SLOT_MS = 30 * 60 * 1000;
const SHOWROOM_DELIVERY_REMINDER_MS = 15 * 60 * 1000;
const SHOWROOM_DELIVERY_PREP_REMINDER_MS = 60 * 60 * 1000;
const SHOWROOM_REPLACEMENT_ARRIVAL_WINDOW_MS = 30 * 60 * 1000;
const SHOWROOM_TIMEZONE = 'Asia/Riyadh';
const SHOWROOM_UTC_OFFSET = '+03:00';

const KANBAN_STATUS_LABELS = {
    ready: 'Ready for Delivery',
    scheduled: 'Scheduled Today',
    process: 'In Delivery Process',
    prep: 'Quality Check',
    done: 'Completed Today',
    delayed: 'Delayed'
};

function appendParkingRecord(store, record) {
    if (!Array.isArray(store.parkingRecords)) store.parkingRecords = [];
    store.parkingRecords.unshift({
        id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        recordedAt: new Date().toISOString(),
        ...record
    });
    if (store.parkingRecords.length > 500) {
        store.parkingRecords = store.parkingRecords.slice(0, 500);
    }
}

function syncShowroomVinsFromParking(store) {
    const vins = new Set();
    (store.parkingSlots || []).forEach((s) => {
        if (s.showroomVin) vins.add(String(s.showroomVin).toUpperCase());
        if (s.replacementVin) vins.add(String(s.replacementVin).toUpperCase());
    });
    store.showroomVins = [...vins].sort();
    rebuildShowroomVehiclesFromSalesRaw(store);
}

function buildParkingRecordSnapshot(store, slot, eventType, extra = {}) {
    const showroom = slot.showroomVin ? lookupSalesRawByVin(store, slot.showroomVin) : null;
    const replacement = slot.replacementVin ? lookupSalesRawByVin(store, slot.replacementVin) : null;
    return {
        eventType,
        slot: slot.slot,
        showroomVin: slot.showroomVin,
        showroomProduct: showroom?.product || null,
        showroomSuffix: showroom?.suffix || null,
        showroomCustomer: showroom?.customerName || null,
        showroomLocation: showroom?.location || null,
        showroomIstimara: slot.showroomIstimaraIssuedDate || slot.istimaraIssuedDate || null,
        replacementVin: slot.replacementVin,
        replacementProduct: replacement?.product || null,
        replacementSuffix: replacement?.suffix || null,
        replacementCustomer: replacement?.customerName || null,
        replacementLocation: replacement?.location || null,
        deliveryAppointmentTime: slot.deliveryAppointmentTime || null,
        departureTime: slot.departureTime || null,
        expectedReplacementArrival: slot.expectedReplacementArrival || null,
        controllerStatus: slot.controllerStatus || extra.controllerStatus || null,
        checklistCarArrived: extra.checklistCarArrived ?? slot.checklistCarArrived ?? null,
        checklistNotDamaged: extra.checklistNotDamaged ?? slot.checklistNotDamaged ?? null,
        checklistWashed: extra.checklistWashed ?? slot.checklistWashed ?? null,
        checklistStickersRemoved: extra.checklistStickersRemoved ?? slot.checklistStickersRemoved ?? null,
        checklistPlated: extra.checklistPlated ?? slot.checklistPlated ?? null,
        securityEntranceAt: extra.securityEntranceAt ?? slot.securityEntranceAt ?? null,
        securityNotDamaged: extra.securityNotDamaged ?? slot.securityNotDamaged ?? null,
        securityDamaged: extra.securityDamaged ?? slot.securityDamaged ?? null,
        securityIstimaraVerified: extra.securityIstimaraVerified ?? slot.securityIstimaraVerified ?? null,
        securityIstimaraVerifiedAt: extra.securityIstimaraVerifiedAt ?? slot.securityIstimaraVerifiedAt ?? null,
        ...extra
    };
}

function emptyParkingSlot(slotNum) {
    return {
        slot: slotNum,
        showroomVin: null,
        replacementVin: null,
        showroomIstimaraIssuedDate: null,
        deliveryAppointmentTime: null,
        departureTime: null,
        expectedReplacementArrival: null,
        originSlot: null,
        deliveryDelayed: false,
        awaitingDeliveryConfirm: false,
        deliveryReminderSent: false,
        prepReminderSent: false,
        timezoneMigrated: false,
        controllerStatus: null,
        checklistCarArrived: false,
        checklistNotDamaged: false,
        checklistWashed: false,
        checklistStickersRemoved: false,
        checklistPlated: false,
        securityEntranceAt: null,
        securityNotDamaged: null,
        securityDamaged: false,
        securityIstimaraVerified: false,
        securityIstimaraVerifiedAt: null,
        updatedAt: new Date().toISOString()
    };
}

function findParkingSlotByVin(store, vin) {
    const target = String(vin || '').trim().toUpperCase();
    if (!target) return null;
    initShowroomParkingSlots(store);
    for (let i = 0; i < store.parkingSlots.length; i++) {
        const slot = store.parkingSlots[i];
        if (slot.showroomVin === target) return { idx: i, slot, vinRole: 'showroom' };
        if (slot.replacementVin === target) return { idx: i, slot, vinRole: 'replacement' };
    }
    return null;
}

function findArrivedCarEntry(store, vin) {
    const target = String(vin || '').trim().toUpperCase();
    if (!target || !Array.isArray(store.arrivedCars)) return null;
    const idx = store.arrivedCars.findIndex((a) => String(a.vin).toUpperCase() === target);
    if (idx < 0) return null;
    return { idx, entry: store.arrivedCars[idx] };
}

function enrichArrivedCarEntry(store, entry) {
    const vin = String(entry.vin || '').trim().toUpperCase();
    const raw = lookupSalesRawByVin(store, vin);
    const pool = buildParkingPoolEntries(store).find((e) => e.vin === vin);
    return {
        ...entry,
        vin,
        customerName: raw?.customerName || pool?.customerName || entry.customerName || null,
        product: raw?.product || pool?.product || raw?.model || null,
        suffix: raw?.suffix || pool?.suffix || null,
        productLabel: formatProductSuffix(raw || pool),
        location: raw?.location || pool?.location || null,
        securityEntranceDisplay: formatShowroomDateTime(parseDateTimeValue(entry.securityEntranceAt)),
        securityIstimaraVerifiedDisplay: formatShowroomDateTime(parseDateTimeValue(entry.securityIstimaraVerifiedAt)),
        kanbanColumn: entry.securityEntranceAt && !entry.securityIstimaraVerified ? 'prep' : (entry.securityIstimaraVerified ? 'scheduled' : 'prep'),
        kanbanStatusLabel: entry.securityEntranceAt && !entry.securityIstimaraVerified
            ? KANBAN_STATUS_LABELS.prep
            : (entry.securityIstimaraVerified ? KANBAN_STATUS_LABELS.scheduled : KANBAN_STATUS_LABELS.prep)
    };
}

function buildArrivedCarsList(store) {
    return (store.arrivedCars || []).map((e) => enrichArrivedCarEntry(store, e));
}

function buildDelayedCarsList(store, now = Date.now()) {
    return processParkingSlots(store, now)
        .filter((s) => s.isOccupied && (s.deliveryDelayed || s.parkingStatus === 'Delayed'))
        .map((s) => ({
            vin: s.showroomVin,
            slot: s.slot,
            customerName: s.showroomCustomer,
            productLabel: s.showroomProductLabel,
            deliveryAppointmentDisplay: s.deliveryAppointmentDisplay,
            deliveryAppointmentMs: s.deliveryAppointmentMs,
            originSlot: s.originSlot,
            isDelayedZone: s.isDelayedZone,
            kanbanStatusLabel: 'Delayed',
            kanbanColumn: 'delayed'
        }));
}

function removeArrivedCar(store, vin) {
    const target = String(vin || '').trim().toUpperCase();
    if (!Array.isArray(store.arrivedCars)) store.arrivedCars = [];
    store.arrivedCars = store.arrivedCars.filter((a) => String(a.vin).toUpperCase() !== target);
}

function parseAssignChecklist(payload = {}) {
    return {
        washed: Boolean(payload.checklistWashed),
        stickersRemoved: Boolean(payload.checklistStickersRemoved),
        notDamaged: Boolean(payload.checklistNotDamaged),
        plated: Boolean(payload.checklistPlated)
    };
}

function validateAssignChecklist(checklist) {
    if (!checklist.washed) return { error: 'Confirm the car is washed before assigning to a bay' };
    if (!checklist.stickersRemoved) return { error: 'Confirm all stickers are removed before assigning to a bay' };
    if (!checklist.notDamaged) return { error: 'Confirm there is no damage before assigning to a bay' };
    if (!checklist.plated) return { error: 'Confirm the car is plated before assigning to a bay' };
    return null;
}

function assignChecklistPatch(checklist) {
    return {
        checklistWashed: Boolean(checklist.washed),
        checklistStickersRemoved: Boolean(checklist.stickersRemoved),
        checklistNotDamaged: Boolean(checklist.notDamaged),
        checklistPlated: Boolean(checklist.plated),
        securityNotDamaged: Boolean(checklist.notDamaged),
        securityDamaged: !checklist.notDamaged
    };
}

function submitSecurityEntrance(store, vin) {
    const targetVin = String(vin || '').trim().toUpperCase();
    if (!targetVin) return { error: 'Select a VIN' };
    if (!isVinInParkingPool(store, targetVin, null, targetVin)) {
        return { error: 'Car must be in Sales Raw Data' };
    }
    const now = new Date().toISOString();
    const found = findParkingSlotByVin(store, targetVin);

    if (found?.vinRole === 'replacement') {
        return { error: 'This VIN is queued as the next car — log entrance for the current bay car first.' };
    }

    const entrancePatch = {
        securityEntranceAt: now,
        securityNotDamaged: null,
        securityDamaged: false,
        updatedAt: now
    };

    if (found?.vinRole === 'showroom') {
        const { idx, slot } = found;
        store.parkingSlots[idx] = {
            ...slot,
            ...entrancePatch
        };
        appendParkingRecord(store, buildParkingRecordSnapshot(store, store.parkingSlots[idx], 'car_entered', {
            controllerStatus: 'in_process',
            kanbanStatus: KANBAN_STATUS_LABELS.prep,
            notes: 'Car marked as entered — awaiting controller bay assign checklist'
        }));
        syncShowroomVinsFromParking(store);
        return { slot: enrichParkingSlot(store, store.parkingSlots[idx]) };
    }

    if (!Array.isArray(store.arrivedCars)) store.arrivedCars = [];
    const existing = findArrivedCarEntry(store, targetVin);
    const entry = {
        vin: targetVin,
        ...entrancePatch,
        securityIstimaraVerified: existing?.entry?.securityIstimaraVerified || false,
        securityIstimaraVerifiedAt: existing?.entry?.securityIstimaraVerifiedAt || null
    };
    if (existing) {
        store.arrivedCars[existing.idx] = entry;
    } else {
        store.arrivedCars.unshift(entry);
    }
    const snapshot = lookupSalesRawByVin(store, targetVin);
    appendParkingRecord(store, {
        eventType: 'car_entered',
        slot: null,
        showroomVin: targetVin,
        showroomProduct: snapshot?.product || null,
        showroomSuffix: snapshot?.suffix || null,
        showroomCustomer: snapshot?.customerName || null,
        showroomLocation: snapshot?.location || null,
        securityEntranceAt: now,
        controllerStatus: 'in_process',
        kanbanStatus: KANBAN_STATUS_LABELS.prep,
        notes: 'Car marked as entered — appears in Arrived cars for controller'
    });
    return { entry: enrichArrivedCarEntry(store, entry) };
}

function submitSecurityIstimaraVerify(store, vin) {
    const targetVin = String(vin || '').trim().toUpperCase();
    const found = findParkingSlotByVin(store, targetVin);
    const now = new Date().toISOString();

    if (found?.vinRole === 'showroom') {
        const { idx, slot } = found;
        if (!slot.securityEntranceAt) return { error: 'Log car entrance at the gate before verifying Istimara.' };
        if (slot.securityDamaged) return { error: 'Cannot verify Istimara — damage was reported at entrance.' };
        store.parkingSlots[idx] = {
            ...slot,
            securityIstimaraVerified: true,
            securityIstimaraVerifiedAt: now,
            updatedAt: now
        };
        appendParkingRecord(store, buildParkingRecordSnapshot(store, store.parkingSlots[idx], 'security_istimara_verified', {
            kanbanStatus: KANBAN_STATUS_LABELS.scheduled,
            notes: 'Istimara verified — Scheduled Today'
        }));
        syncShowroomVinsFromParking(store);
        return { slot: enrichParkingSlot(store, store.parkingSlots[idx]) };
    }

    const arrived = findArrivedCarEntry(store, targetVin);
    if (!arrived) return { error: 'Car not found. Log entrance at the gate first.' };
    const { entry } = arrived;
    if (!entry.securityEntranceAt) return { error: 'Log car entrance at the gate before verifying Istimara.' };
    if (entry.securityDamaged) return { error: 'Cannot verify Istimara — damage was reported at entrance.' };
    store.arrivedCars[arrived.idx] = {
        ...entry,
        securityIstimaraVerified: true,
        securityIstimaraVerifiedAt: now,
        updatedAt: now
    };
    const snapshot = lookupSalesRawByVin(store, targetVin);
    appendParkingRecord(store, {
        eventType: 'security_istimara_verified',
        slot: null,
        showroomVin: targetVin,
        showroomProduct: snapshot?.product || null,
        showroomSuffix: snapshot?.suffix || null,
        showroomCustomer: snapshot?.customerName || null,
        securityEntranceAt: entry.securityEntranceAt,
        securityIstimaraVerifiedAt: now,
        kanbanStatus: KANBAN_STATUS_LABELS.scheduled,
        notes: 'Istimara verified — assign to parking and book delivery'
    });
    return { entry: enrichArrivedCarEntry(store, store.arrivedCars[arrived.idx]) };
}

function buildSecurityCarsList(store, now = Date.now()) {
    const inParking = new Set();
    (store.parkingSlots || []).forEach((s) => {
        if (s.showroomVin) inParking.add(String(s.showroomVin).toUpperCase());
    });
    const pool = buildParkingPoolEntries(store);
    const list = [];
    pool.forEach((p) => {
        if (inParking.has(p.vin)) return;
        const arrived = findArrivedCarEntry(store, p.vin);
        const base = arrived ? enrichArrivedCarEntry(store, arrived.entry) : {
            vin: p.vin,
            customerName: p.customerName,
            productLabel: p.productLabel,
            kanbanColumn: 'prep',
            kanbanStatusLabel: KANBAN_STATUS_LABELS.prep
        };
        list.push({ ...base, inParking: false, slot: null });
    });
    processParkingSlots(store, now)
        .filter((s) => s.isOccupied && s.showroomVin)
        .forEach((s) => {
            list.push({
                vin: s.showroomVin,
                slot: s.slot,
                customerName: s.showroomCustomer,
                productLabel: s.showroomProductLabel,
                deliveryAppointmentDisplay: s.deliveryAppointmentDisplay,
                deliveryAppointmentMs: s.deliveryAppointmentMs,
                securityEntranceAt: s.securityEntranceAt,
                securityEntranceDisplay: s.securityEntranceDisplay,
                securityNotDamaged: s.securityNotDamaged,
                securityDamaged: s.securityDamaged,
                securityIstimaraVerified: s.securityIstimaraVerified,
                securityIstimaraVerifiedDisplay: s.securityIstimaraVerifiedDisplay,
                kanbanStatus: s.kanbanStatusLabel,
                kanbanColumn: s.kanbanColumn,
                inParking: true
            });
        });
    return list;
}

function rescheduleDelayedParking(store, slotNumber, payload = {}) {
    const slot = Number(slotNumber);
    if (!Number.isInteger(slot) || slot < 1 || slot > SHOWROOM_PARKING_SLOTS) {
        return { error: `Parking slot must be between 1 and ${SHOWROOM_PARKING_SLOTS}` };
    }
    initShowroomParkingSlots(store);
    const idx = slot - 1;
    const current = store.parkingSlots[idx];
    if (!current?.showroomVin) return { error: 'Parking slot is empty' };
    if (!current.deliveryDelayed && current.parkingStatus !== 'Delayed') {
        return { error: 'This car is not in delayed status' };
    }
    const istimaraIssued = Boolean(payload.istimaraIssued ?? true);
    const deliveryAppointmentTime = payload.deliveryAppointmentTime;
    const appointmentMs = parseDateTimeValue(deliveryAppointmentTime);
    if (!appointmentMs) return { error: 'New delivery date and time are required' };
    const conflict = validateDeliveryTimeConflict(store, slot, appointmentMs, current);
    if (conflict) return conflict;

    const updated = {
        ...current,
        deliveryAppointmentTime: new Date(appointmentMs).toISOString(),
        departureTime: new Date(appointmentMs + SHOWROOM_DELIVERY_SLOT_MS).toISOString(),
        deliveryDelayed: false,
        awaitingDeliveryConfirm: false,
        deliveryReminderSent: false,
        prepReminderSent: false,
        controllerStatus: 'in_process',
        showroomIstimaraIssuedDate: current.showroomIstimaraIssuedDate || new Date().toISOString().slice(0, 10),
        updatedAt: new Date().toISOString()
    };
    store.parkingSlots[idx] = updated;
    appendParkingRecord(store, buildParkingRecordSnapshot(store, updated, 'delayed_rescheduled', {
        kanbanStatus: KANBAN_STATUS_LABELS.scheduled,
        notes: `New delivery scheduled: ${formatShowroomDateTime(appointmentMs)}`
    }));
    syncShowroomVinsFromParking(store);
    return { slot: enrichParkingSlot(store, updated) };
}

function isParkingFull(store) {
    initShowroomParkingSlots(store);
    return store.parkingSlots.every((s) => Boolean(s.showroomVin));
}

function getQueueVins(store) {
    return new Set((store.parkingQueue || []).filter((q) => q.status === 'waiting').map((q) => String(q.vin).toUpperCase()));
}

function findSlotWithSoonestDelivery(store) {
    let bestSlot = null;
    let bestMs = Infinity;
    (store.parkingSlots || []).forEach((s) => {
        if (!s.showroomVin || SHOWROOM_DELAYED_ZONE_SLOTS.includes(Number(s.slot))) return;
        const appt = parseDateTimeValue(s.deliveryAppointmentTime);
        if (appt && appt < bestMs) {
            bestMs = appt;
            bestSlot = s.slot;
        }
    });
    return bestSlot;
}

function enrichQueueEntry(store, entry) {
    const vin = String(entry.vin || '').toUpperCase();
    const raw = lookupSalesRawByVin(store, vin);
    const match = buildParkingPoolEntries(store).find((e) => e.vin === vin);
    return {
        ...entry,
        vin,
        customerName: raw?.customerName || match?.customerName || null,
        product: raw?.product || match?.product || raw?.model || null,
        suffix: raw?.suffix || match?.suffix || null,
        productLabel: formatProductSuffix(raw || match),
        targetSlot: entry.targetSlot || findSlotWithSoonestDelivery(store)
    };
}

function assignQueueItemToSlot(store, item, slotNum) {
    const idx = Number(slotNum) - 1;
    if (idx < 0 || idx >= SHOWROOM_PARKING_SLOTS) return false;
    if (store.parkingSlots[idx]?.showroomVin) return false;
    const vin = String(item.vin).toUpperCase();
    store.parkingSlots[idx] = {
        ...emptyParkingSlot(slotNum),
        showroomVin: vin,
        controllerStatus: 'in_process',
        updatedAt: new Date().toISOString()
    };
    item.status = 'assigned';
    item.assignedSlot = slotNum;
    item.assignedAt = new Date().toISOString();
    appendParkingRecord(store, buildParkingRecordSnapshot(store, store.parkingSlots[idx], 'queue_assigned', {
        notes: `Queue car assigned to Parking ${slotNum}`
    }));
    syncShowroomVinsFromParking(store);
    return true;
}

function tryAssignQueueToSlot(store, freedSlot) {
    if (!Array.isArray(store.parkingQueue)) store.parkingQueue = [];
    const waiting = store.parkingQueue.filter((q) => q.status === 'waiting');
    if (!waiting.length) return false;
    let item = waiting.find((q) => q.targetSlot === freedSlot) || waiting[0];
    if (store.parkingSlots[freedSlot - 1]?.showroomVin) {
        const emptyNormal = store.parkingSlots.find(
            (s) => !s.showroomVin && !SHOWROOM_DELAYED_ZONE_SLOTS.includes(Number(s.slot))
        );
        if (!emptyNormal) return false;
        return assignQueueItemToSlot(store, item, emptyNormal.slot);
    }
    return assignQueueItemToSlot(store, item, freedSlot);
}

function addParkingQueueEntry(store, vin) {
    initShowroomParkingSlots(store);
    const targetVin = String(vin || '').trim().toUpperCase();
    if (!targetVin) return { error: 'Select a VIN' };
    if (!isVinInParkingPool(store, targetVin, null, targetVin)) {
        return { error: 'Car must be in Sales Raw Data' };
    }
    const occupied = new Set();
    store.parkingSlots.forEach((s) => {
        if (s.showroomVin) occupied.add(String(s.showroomVin).toUpperCase());
    });
    if (occupied.has(targetVin)) return { error: 'This VIN is already in a parking spot' };
    if (getQueueVins(store).has(targetVin)) return { error: 'This VIN is already in the queue' };
    if (!isParkingFull(store)) return { error: 'Parking is not full — assign the car to a spot directly' };
    const targetSlot = findSlotWithSoonestDelivery(store);
    const entry = {
        id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        vin: targetVin,
        addedAt: new Date().toISOString(),
        targetSlot,
        status: 'waiting'
    };
    if (!Array.isArray(store.parkingQueue)) store.parkingQueue = [];
    store.parkingQueue.unshift(entry);
    const snapshot = lookupSalesRawByVin(store, targetVin);
    appendParkingRecord(store, {
        eventType: 'queued',
        slot: targetSlot,
        showroomVin: targetVin,
        showroomProduct: snapshot?.product || null,
        showroomSuffix: snapshot?.suffix || null,
        showroomCustomer: snapshot?.customerName || null,
        showroomLocation: snapshot?.location || null,
        notes: targetSlot
            ? `Waiting for Parking ${targetSlot} (soonest delivery)`
            : 'Waiting for the next empty parking spot'
    });
    return { entry: enrichQueueEntry(store, entry), targetSlot };
}

function findEmptyDelayedSlot(store) {
    for (const slotNum of SHOWROOM_DELAYED_ZONE_SLOTS) {
        const slot = store.parkingSlots[slotNum - 1];
        if (!slot?.showroomVin) return slotNum;
    }
    return null;
}

function moveToDelayedZone(store, fromSlotNum) {
    const fromIdx = Number(fromSlotNum) - 1;
    const current = store.parkingSlots[fromIdx];
    if (!current?.showroomVin) return { error: 'Parking slot is empty' };
    const delayedSlot = findEmptyDelayedSlot(store);
    if (!delayedSlot) return { error: 'Delayed zone (Parking 8–10) is full' };
    const moved = {
        ...current,
        slot: delayedSlot,
        originSlot: fromSlotNum,
        deliveryDelayed: true,
        awaitingDeliveryConfirm: false,
        controllerStatus: 'delayed',
        updatedAt: new Date().toISOString()
    };
    appendParkingRecord(store, buildParkingRecordSnapshot(store, moved, 'delayed', {
        kanbanStatus: 'Delayed',
        notes: `Not delivered — moved from Parking ${fromSlotNum} to delayed zone P${delayedSlot}`
    }));
    store.parkingSlots[delayedSlot - 1] = moved;
    store.parkingSlots[fromIdx] = emptyParkingSlot(fromSlotNum);
    syncShowroomVinsFromParking(store);
    tryAssignQueueToSlot(store, fromSlotNum);
    return { slot: enrichParkingSlot(store, store.parkingSlots[delayedSlot - 1]) };
}

function finishParkingDelivery(store, slotNumber, checklist = {}) {
    const slot = Number(slotNumber);
    const idx = slot - 1;
    const current = store.parkingSlots[idx];
    if (!current?.showroomVin) return { error: 'Parking slot is empty' };
    appendParkingRecord(store, buildParkingRecordSnapshot(store, current, 'delivered', {
        controllerStatus: 'delivered',
        kanbanStatus: KANBAN_STATUS_LABELS.done,
        checklistCarArrived: Boolean(checklist.carArrived),
        checklistNotDamaged: Boolean(checklist.notDamaged),
        checklistWashed: Boolean(checklist.washed),
        notes: current.replacementVin
            ? 'Customer collected vehicle — next car promoted to spot'
            : 'Customer collected vehicle'
    }));
    if (current.replacementVin) {
        store.parkingSlots[idx] = {
            ...emptyParkingSlot(slot),
            showroomVin: current.replacementVin,
            controllerStatus: 'in_process',
            updatedAt: new Date().toISOString()
        };
    } else {
        store.parkingSlots[idx] = emptyParkingSlot(slot);
        tryAssignQueueToSlot(store, slot);
    }
    syncShowroomVinsFromParking(store);
    return { ok: true };
}

function deliveryWindowsOverlap(startA, endA, startB, endB) {
    return startA < endB && endA > startB;
}

function validateDeliveryTimeConflict(store, slotNumber, appointmentMs, currentSlot = null) {
    if (!appointmentMs) return null;
    const windowStart = appointmentMs;
    const windowEnd = appointmentMs + SHOWROOM_DELIVERY_SLOT_MS;
    for (const s of store.parkingSlots) {
        if (Number(s.slot) === Number(slotNumber)) continue;
        if (!s.showroomVin || !s.showroomIstimaraIssuedDate || !s.deliveryAppointmentTime) continue;
        if (s.controllerStatus === 'delivered') continue;
        const otherStart = parseDateTimeValue(s.deliveryAppointmentTime);
        if (!otherStart) continue;
        const otherEnd = otherStart + SHOWROOM_DELIVERY_SLOT_MS;
        if (deliveryWindowsOverlap(windowStart, windowEnd, otherStart, otherEnd)) {
            return {
                error: `Delivery time blocked: Parking ${s.slot} is scheduled ${formatShowroomDateTime(otherStart)} – ${formatShowroomDateTime(otherEnd)}`
            };
        }
    }
    if (currentSlot?.showroomIstimaraIssuedDate && currentSlot?.deliveryAppointmentTime) {
        const curStart = parseDateTimeValue(currentSlot.deliveryAppointmentTime);
        if (curStart && appointmentMs !== curStart && currentSlot.awaitingDeliveryConfirm) {
            return { error: 'Complete or delay the current delivery before changing the appointment time' };
        }
    }
    return null;
}

function migrateParkingSlotTimezones(store) {
    const OFFSET_MS = 3 * 60 * 60 * 1000;
    let changed = false;
    (store.parkingSlots || []).forEach((slot, idx) => {
        if (slot.timezoneMigrated || !slot.deliveryAppointmentTime) return;
        const fixIso = (val) => {
            if (!val) return null;
            const ms = Date.parse(val);
            if (isNaN(ms)) return val;
            return new Date(ms - OFFSET_MS).toISOString();
        };
        store.parkingSlots[idx] = {
            ...slot,
            deliveryAppointmentTime: fixIso(slot.deliveryAppointmentTime),
            departureTime: fixIso(slot.departureTime),
            expectedReplacementArrival: fixIso(slot.expectedReplacementArrival),
            timezoneMigrated: true,
            updatedAt: new Date().toISOString()
        };
        changed = true;
    });
    return changed;
}

function processParkingDeliveryRotations(store, now = Date.now()) {
    initShowroomParkingSlots(store);
    let changed = false;
    store.parkingSlots.forEach((slot, idx) => {
        if (!slot.showroomVin) return;
        const appointmentMs = parseDateTimeValue(slot.deliveryAppointmentTime);
        const hasDelivery = Boolean(slot.showroomIstimaraIssuedDate && appointmentMs);
        if (!hasDelivery) return;

        const prepAt = appointmentMs - SHOWROOM_DELIVERY_PREP_REMINDER_MS;
        if (now >= prepAt && now < appointmentMs && !slot.prepReminderSent) {
            store.parkingSlots[idx] = {
                ...slot,
                prepReminderSent: true,
                updatedAt: new Date().toISOString()
            };
            appendParkingRecord(store, buildParkingRecordSnapshot(store, store.parkingSlots[idx], 'delivery_prep_reminder', {
                notes: 'Prepare car — wash and ready for guest (1 hour before delivery)'
            }));
            changed = true;
            slot = store.parkingSlots[idx];
        }

        const reminderAt = appointmentMs - SHOWROOM_DELIVERY_REMINDER_MS;
        if (now >= reminderAt && now < appointmentMs && !slot.deliveryReminderSent) {
            store.parkingSlots[idx] = {
                ...slot,
                deliveryReminderSent: true,
                updatedAt: new Date().toISOString()
            };
            appendParkingRecord(store, buildParkingRecordSnapshot(store, store.parkingSlots[idx], 'delivery_reminder', {
                notes: 'Car ready for customer in 15 minutes'
            }));
            changed = true;
            slot = store.parkingSlots[idx];
        }

        if (now >= appointmentMs && !slot.awaitingDeliveryConfirm && slot.controllerStatus !== 'delivered') {
            store.parkingSlots[idx] = {
                ...slot,
                awaitingDeliveryConfirm: true,
                controllerStatus: 'in_process',
                updatedAt: new Date().toISOString()
            };
            appendParkingRecord(store, buildParkingRecordSnapshot(store, store.parkingSlots[idx], 'delivery_started', {
                kanbanStatus: KANBAN_STATUS_LABELS.process,
                notes: 'Delivery time — confirm delivered or delayed'
            }));
            changed = true;
        }
    });
    if (changed) syncShowroomVinsFromParking(store);
    return changed;
}

function completeParkingDelivery(store, slotNumber, checklist = {}) {
    return finishParkingDelivery(store, slotNumber, checklist);
}

function confirmParkingDelivery(store, slotNumber, payload = {}) {
    const slot = Number(slotNumber);
    if (!Number.isInteger(slot) || slot < 1 || slot > SHOWROOM_PARKING_SLOTS) {
        return { error: `Parking slot must be between 1 and ${SHOWROOM_PARKING_SLOTS}` };
    }
    initShowroomParkingSlots(store);
    const idx = slot - 1;
    const current = store.parkingSlots[idx];
    if (!current?.showroomVin) return { error: 'Parking slot is empty' };
    if (!current.awaitingDeliveryConfirm && !current.deliveryDelayed) {
        return { error: 'This slot is not at delivery time yet' };
    }

    const delivered = Boolean(payload.delivered);
    const checklist = {
        carArrived: Boolean(payload.checklistCarArrived),
        notDamaged: Boolean(payload.checklistNotDamaged),
        washed: Boolean(payload.checklistWashed)
    };

    if (delivered) {
        if (!checklist.carArrived || !checklist.notDamaged || !checklist.washed) {
            return { error: 'Complete all checklist items (car arrived, not damaged, washed) before confirming delivery' };
        }
        store.parkingSlots[idx] = {
            ...current,
            checklistCarArrived: true,
            checklistNotDamaged: true,
            checklistWashed: true,
            controllerStatus: 'in_process'
        };
        const result = finishParkingDelivery(store, slot, checklist);
        if (result.error) return result;
        return { slot: enrichParkingSlot(store, store.parkingSlots[idx]) };
    }

    return moveToDelayedZone(store, slot);
}

function applyParkingRotations(store, now = Date.now()) {
    return processParkingDeliveryRotations(store, now);
}

function validateParkingSchedule({ istimaraIssued, deliveryAppointmentTime, replacementVin, expectedReplacementArrival }) {
    if (!istimaraIssued) return null;
    const appointmentMs = parseDateTimeValue(deliveryAppointmentTime);
    if (!appointmentMs) return { error: 'Delivery date and time are required when Istimara is issued' };
    if (replacementVin) {
        const arrivalMs = parseDateTimeValue(expectedReplacementArrival);
        if (!arrivalMs) return { error: 'Next car arrival time is required' };
        if (arrivalMs >= appointmentMs) {
            return { error: 'Next car must arrive before the delivery appointment time' };
        }
    }
    return null;
}

function parseDateTimeValue(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date && !isNaN(value.getTime())) return value.getTime();
    const str = String(value).trim();
    if (!str) return null;
    if (/Z$/i.test(str) || /[+-]\d{2}:\d{2}$/.test(str)) {
        const parsed = Date.parse(str);
        return isNaN(parsed) ? null : parsed;
    }
    const localMatch = str.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?$/);
    if (localMatch) {
        const seconds = localMatch[2] || '00';
        const parsed = Date.parse(`${localMatch[1]}:${seconds}${SHOWROOM_UTC_OFFSET}`);
        return isNaN(parsed) ? null : parsed;
    }
    const parsed = Date.parse(str);
    return isNaN(parsed) ? null : parsed;
}

function formatShowroomDateTime(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleString('en-GB', {
        timeZone: SHOWROOM_TIMEZONE,
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

function formatShowroomDate(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleDateString('en-GB');
}

function formatProductSuffix(vehicle) {
    if (!vehicle) return '—';
    const product = String(vehicle.product || vehicle.model || '').trim();
    const suffix = String(vehicle.suffix || '').trim();
    if (product && suffix) return `${product} · ${suffix}`;
    return product || suffix || '—';
}

function lookupSalesRawByVin(store, vin) {
    const target = String(vin || '').trim().toUpperCase();
    if (!target) return null;
    const rows = store.salesRaw?.rows || [];
    for (let i = 0; i < rows.length; i++) {
        const normalized = normalizeShowroomVehicle(rows[i], i);
        if (normalized.vin && normalized.vin.toUpperCase() === target) return normalized;
    }
    return null;
}

function computeKanbanColumnForSlot(slot, now = Date.now()) {
    if (!slot?.showroomVin && !slot?.isArrivedEntry) return null;
    const appointmentMs = slot.deliveryAppointmentMs ?? parseDateTimeValue(slot.deliveryAppointmentTime);
    const istimaraIssued = Boolean(slot.istimaraIssued || slot.showroomIstimaraIssuedDate || appointmentMs);

    if (slot.parkingStatus === 'Delivering' || slot.awaitingDeliveryConfirm
        || (istimaraIssued && appointmentMs && now >= appointmentMs)) {
        return 'process';
    }

    const prepAt = appointmentMs ? appointmentMs - SHOWROOM_DELIVERY_PREP_REMINDER_MS : null;
    if (slot.securityIstimaraVerified && appointmentMs && prepAt && now >= prepAt && now < appointmentMs) {
        return 'ready';
    }
    if (slot.deliveryReminderActive || slot.carReadyForCustomer) {
        return 'ready';
    }

    if (slot.securityIstimaraVerified && appointmentMs && (!prepAt || now < prepAt)) {
        return 'scheduled';
    }

    if (slot.securityEntranceAt && !slot.securityIstimaraVerified) {
        return 'prep';
    }

    if (slot.deliveryDelayed || slot.parkingStatus === 'Delayed') {
        return 'scheduled';
    }

    if (slot.parkingStatus === 'Delivery Booked' || (istimaraIssued && appointmentMs)) {
        return 'scheduled';
    }

    return 'prep';
}

function enrichParkingSlot(store, slot, now = Date.now()) {
    const showroom = slot.showroomVin ? lookupSalesRawByVin(store, slot.showroomVin) : null;
    const replacement = slot.replacementVin ? lookupSalesRawByVin(store, slot.replacementVin) : null;
    let departureMs = parseDateTimeValue(slot.departureTime);
    let appointmentMs = parseDateTimeValue(slot.deliveryAppointmentTime);
    if (!appointmentMs && departureMs) {
        appointmentMs = departureMs - SHOWROOM_DELIVERY_SLOT_MS;
    }
    const arrivalMs = parseDateTimeValue(slot.expectedReplacementArrival);
    const showroomIstimara = slot.showroomIstimaraIssuedDate || slot.istimaraIssuedDate;
    const istimaraMs = parseDateValue(showroomIstimara);
    const istimaraIssued = Boolean(showroomIstimara || appointmentMs);
    const deliveryDueMs = appointmentMs;
    const timeRemainingMs = deliveryDueMs && istimaraIssued ? deliveryDueMs - now : null;
    const reminderAt = appointmentMs ? appointmentMs - SHOWROOM_DELIVERY_REMINDER_MS : null;
    const prepAt = appointmentMs ? appointmentMs - SHOWROOM_DELIVERY_PREP_REMINDER_MS : null;
    const deliveryReminderActive = Boolean(
        appointmentMs && istimaraIssued && now >= reminderAt && now < appointmentMs
    );
    const prepReminderActive = Boolean(
        appointmentMs && istimaraIssued && now >= prepAt && now < appointmentMs
    );
    const carReadyForCustomer = Boolean(
        appointmentMs && istimaraIssued && now >= reminderAt && now < appointmentMs + SHOWROOM_DELIVERY_SLOT_MS
    );
    const customerName = (showroom?.customerName || '').trim();
    const customerReadyMessage = carReadyForCustomer && customerName
        ? `${customerName}, your car is ready`
        : null;
    let controllerStatus = slot.controllerStatus || null;
    if (slot.showroomVin && !controllerStatus) {
        if (slot.deliveryDelayed) controllerStatus = 'delayed';
        else if (istimaraIssued || slot.awaitingDeliveryConfirm) controllerStatus = 'in_process';
        else controllerStatus = 'in_process';
    }
    let parkingStatus = 'Empty';
    const isDelayedZone = SHOWROOM_DELAYED_ZONE_SLOTS.includes(Number(slot.slot));
    if (slot.showroomVin) {
        if (deliveryReminderActive) parkingStatus = 'Delivery in 15 Min';
        else if (slot.deliveryDelayed || controllerStatus === 'delayed') parkingStatus = 'Delayed';
        else if (slot.awaitingDeliveryConfirm) parkingStatus = 'Confirm Delivery';
        else if (!istimaraIssued) parkingStatus = 'Occupied';
        else if (slot.replacementVin && arrivalMs && arrivalMs > now && appointmentMs) parkingStatus = 'Awaiting Replacement';
        else if (appointmentMs && now < appointmentMs) parkingStatus = 'Delivery Booked';
        else if (appointmentMs && now >= appointmentMs) parkingStatus = 'Delivering';
        else parkingStatus = 'Occupied';
    }
    const enrichedPartial = {
        istimaraIssued,
        deliveryAppointmentMs: appointmentMs,
        deliveryReminderActive,
        prepReminderActive,
        carReadyForCustomer,
        parkingStatus,
        awaitingDeliveryConfirm: Boolean(slot.awaitingDeliveryConfirm)
    };
    const kanbanColumn = slot.showroomVin ? computeKanbanColumnForSlot({ ...slot, ...enrichedPartial }, now) : null;
    const kanbanStatusLabel = kanbanColumn ? (KANBAN_STATUS_LABELS[kanbanColumn] || kanbanColumn) : null;
    const securityEntranceMs = parseDateTimeValue(slot.securityEntranceAt);
    const securityIstimaraMs = parseDateTimeValue(slot.securityIstimaraVerifiedAt);
    return {
        ...slot,
        showroomIstimaraIssuedDate: showroomIstimara || null,
        deliveryAppointmentTime: slot.deliveryAppointmentTime || (appointmentMs ? new Date(appointmentMs).toISOString() : null),
        istimaraIssued,
        isOccupied: Boolean(slot.showroomVin),
        showroomVehicleNumber: showroom?.vehicleNumber || null,
        showroomModel: showroom?.model || null,
        showroomProduct: showroom?.product || showroom?.model || null,
        showroomSuffix: showroom?.suffix || null,
        showroomCustomer: showroom?.customerName || null,
        showroomLocation: showroom?.location || null,
        showroomProductLabel: formatProductSuffix(showroom),
        replacementVehicleNumber: replacement?.vehicleNumber || null,
        replacementProduct: replacement?.product || null,
        replacementSuffix: replacement?.suffix || null,
        replacementCustomer: replacement?.customerName || null,
        replacementProductLabel: formatProductSuffix(replacement),
        replacementLocation: replacement?.location || null,
        istimaraMs,
        istimaraDisplay: formatShowroomDate(istimaraMs),
        deliveryAppointmentMs: appointmentMs,
        deliveryAppointmentDisplay: formatShowroomDateTime(appointmentMs),
        deliveryEndsDisplay: formatShowroomDateTime(departureMs),
        departureMs,
        departureDisplay: formatShowroomDateTime(departureMs),
        expectedArrivalMs: arrivalMs,
        expectedArrivalDisplay: formatShowroomDateTime(arrivalMs),
        timeRemainingMs,
        timeRemainingLabel: istimaraIssued && deliveryDueMs
            ? (now >= deliveryDueMs ? 'DELIVERING' : formatDuration(deliveryDueMs - now))
            : '—',
        deliveryReminderActive,
        prepReminderActive,
        carReadyForCustomer,
        customerReadyMessage,
        controllerStatus,
        checklistCarArrived: Boolean(slot.checklistCarArrived),
        checklistNotDamaged: Boolean(slot.checklistNotDamaged),
        checklistWashed: Boolean(slot.checklistWashed),
        checklistStickersRemoved: Boolean(slot.checklistStickersRemoved),
        checklistPlated: Boolean(slot.checklistPlated),
        securityEntranceAt: slot.securityEntranceAt || null,
        securityEntranceDisplay: formatShowroomDateTime(securityEntranceMs),
        securityNotDamaged: slot.securityNotDamaged ?? null,
        securityDamaged: Boolean(slot.securityDamaged),
        securityIstimaraVerified: Boolean(slot.securityIstimaraVerified),
        securityIstimaraVerifiedAt: slot.securityIstimaraVerifiedAt || null,
        securityIstimaraVerifiedDisplay: formatShowroomDateTime(securityIstimaraMs),
        kanbanColumn,
        kanbanStatusLabel,
        deliveryWindowEndMs: appointmentMs ? appointmentMs + SHOWROOM_DELIVERY_SLOT_MS : null,
        parkingStatus,
        isDelayedZone,
        deliveryDelayed: Boolean(slot.deliveryDelayed),
        awaitingDeliveryConfirm: Boolean(slot.awaitingDeliveryConfirm),
        deliveryReminderSent: Boolean(slot.deliveryReminderSent),
        originSlot: slot.originSlot ? Number(slot.originSlot) : null,
        productImageKey: showroom?.product || showroom?.model || null
    };
}

function processParkingSlots(store, now = Date.now()) {
    initShowroomParkingSlots(store);
    return store.parkingSlots.map((slot) => enrichParkingSlot(store, slot, now));
}

function upsertParkingSlot(store, slotNumber, payload = {}) {
    const slot = Number(slotNumber);
    if (!Number.isInteger(slot) || slot < 1 || slot > SHOWROOM_PARKING_SLOTS) {
        return { error: `Parking slot must be between 1 and ${SHOWROOM_PARKING_SLOTS}` };
    }
    initShowroomParkingSlots(store);
    const idx = slot - 1;
    const currentSlot = store.parkingSlots[idx];
    const showroomVin = String(payload.showroomVin || '').trim().toUpperCase() || null;
    const istimaraIssued = Boolean(payload.istimaraIssued);
    let deliveryAppointmentTime = payload.deliveryAppointmentTime || null;
    let showroomIstimaraIssuedDate = null;
    let departureTime = null;

    if (istimaraIssued) {
        showroomIstimaraIssuedDate = currentSlot?.showroomIstimaraIssuedDate || new Date().toISOString().slice(0, 10);
        const appointmentMs = parseDateTimeValue(deliveryAppointmentTime);
        if (!appointmentMs) {
            return { error: 'Delivery date and time are required when Istimara is issued' };
        }
        const conflict = validateDeliveryTimeConflict(store, slot, appointmentMs, currentSlot);
        if (conflict) return conflict;
        deliveryAppointmentTime = new Date(appointmentMs).toISOString();
        departureTime = new Date(appointmentMs + SHOWROOM_DELIVERY_SLOT_MS).toISOString();
    } else {
        deliveryAppointmentTime = null;
        departureTime = null;
        showroomIstimaraIssuedDate = null;
    }

    if (!showroomVin) {
        return { error: 'Select a car from the list' };
    }
    if (!isVinInParkingPool(store, showroomVin, slot, showroomVin)) {
        return { error: 'Car must be in Sales Raw Data (upload via Data Uploader)' };
    }
    const duplicate = store.parkingSlots.find(
        (s) => s.slot !== slot && (s.showroomVin === showroomVin || s.replacementVin === showroomVin)
    );
    if (duplicate) {
        return { error: `This VIN is already assigned to Parking ${duplicate.slot}` };
    }
    if (getQueueVins(store).has(showroomVin)) {
        return { error: 'This VIN is waiting in the queue — remove from queue first' };
    }

    const scheduleError = validateParkingSchedule({
        istimaraIssued,
        deliveryAppointmentTime,
        replacementVin: currentSlot?.showroomVin === showroomVin ? currentSlot.replacementVin : null,
        expectedReplacementArrival: currentSlot?.showroomVin === showroomVin ? currentSlot.expectedReplacementArrival : null
    });
    if (scheduleError) return scheduleError;

    const record = {
        slot,
        showroomVin,
        replacementVin: currentSlot?.showroomVin === showroomVin ? (currentSlot.replacementVin || null) : null,
        expectedReplacementArrival: currentSlot?.showroomVin === showroomVin ? (currentSlot.expectedReplacementArrival || null) : null,
        showroomIstimaraIssuedDate,
        deliveryAppointmentTime,
        departureTime,
        deliveryDelayed: false,
        awaitingDeliveryConfirm: false,
        deliveryReminderSent: istimaraIssued && currentSlot?.deliveryAppointmentTime === deliveryAppointmentTime
            ? Boolean(currentSlot.deliveryReminderSent)
            : false,
        prepReminderSent: istimaraIssued && currentSlot?.deliveryAppointmentTime === deliveryAppointmentTime
            ? Boolean(currentSlot.prepReminderSent)
            : false,
        timezoneMigrated: true,
        controllerStatus: istimaraIssued ? 'in_process' : 'in_process',
        checklistCarArrived: false,
        checklistNotDamaged: false,
        checklistWashed: false,
        checklistStickersRemoved: false,
        checklistPlated: false,
        originSlot: currentSlot?.originSlot || null,
        updatedAt: new Date().toISOString()
    };
    appendParkingRecord(store, buildParkingRecordSnapshot(store, record, 'assigned'));
    store.parkingSlots[idx] = record;

    syncShowroomVinsFromParking(store);

    return { slot: enrichParkingSlot(store, record) };
}

function quickAssignParkingSlot(store, slotNumber, showroomVin, payload = {}) {
    const vin = String(showroomVin || '').trim().toUpperCase();
    const checklist = parseAssignChecklist(payload);
    const checklistError = validateAssignChecklist(checklist);
    if (checklistError) return checklistError;
    const checklistFields = assignChecklistPatch(checklist);

    const result = upsertParkingSlot(store, slotNumber, {
        showroomVin: vin,
        istimaraIssued: false
    });
    if (result.error) return result;
    const idx = Number(slotNumber) - 1;
    const arrived = findArrivedCarEntry(store, vin);
    store.parkingSlots[idx] = {
        ...store.parkingSlots[idx],
        ...checklistFields,
        securityEntranceAt: arrived?.entry?.securityEntranceAt || store.parkingSlots[idx].securityEntranceAt || null,
        securityIstimaraVerified: Boolean(arrived?.entry?.securityIstimaraVerified || store.parkingSlots[idx].securityIstimaraVerified),
        securityIstimaraVerifiedAt: arrived?.entry?.securityIstimaraVerifiedAt || store.parkingSlots[idx].securityIstimaraVerifiedAt || null
    };
    if (arrived) removeArrivedCar(store, vin);
    appendParkingRecord(store, buildParkingRecordSnapshot(store, store.parkingSlots[idx], 'assigned_to_bay', {
        ...checklistFields,
        kanbanStatus: store.parkingSlots[idx].securityIstimaraVerified
            ? KANBAN_STATUS_LABELS.scheduled
            : KANBAN_STATUS_LABELS.prep,
        notes: 'Assigned to bay — assign checklist completed'
    }));
    return { slot: enrichParkingSlot(store, store.parkingSlots[idx]) };
}

function addNextCarToParkingSlot(store, slotNumber, payload = {}) {
    const slot = Number(slotNumber);
    if (!Number.isInteger(slot) || slot < 1 || slot > SHOWROOM_PARKING_SLOTS) {
        return { error: `Parking slot must be between 1 and ${SHOWROOM_PARKING_SLOTS}` };
    }
    initShowroomParkingSlots(store);
    const idx = slot - 1;
    const current = store.parkingSlots[idx];
    if (!current?.showroomVin) {
        return { error: 'Parking spot is empty — assign the first car first' };
    }
    if (current.replacementVin) {
        return { error: 'This spot already has a next car scheduled' };
    }

    const replacementVin = String(payload.replacementVin || payload.showroomVin || '').trim().toUpperCase();
    const expectedReplacementArrival = payload.expectedReplacementArrival || null;
    let deliveryAppointmentTime = payload.deliveryAppointmentTime || current.deliveryAppointmentTime || null;
    const istimaraIssued = Boolean(payload.istimaraIssued ?? current.showroomIstimaraIssuedDate ?? deliveryAppointmentTime);

    if (!replacementVin) return { error: 'Select a car for the next slot' };
    if (replacementVin === current.showroomVin) {
        return { error: 'Next car must be different from the current car' };
    }
    if (!isVinInParkingPool(store, replacementVin, slot, replacementVin)) {
        return { error: 'Car must be in Sales Raw Data' };
    }
    const duplicate = store.parkingSlots.find(
        (s) => s.slot !== slot && (s.showroomVin === replacementVin || s.replacementVin === replacementVin)
    );
    if (duplicate) return { error: `This VIN is already used in Parking ${duplicate.slot}` };
    if (getQueueVins(store).has(replacementVin)) {
        return { error: 'This VIN is waiting in the queue' };
    }

    let showroomIstimaraIssuedDate = current.showroomIstimaraIssuedDate || new Date().toISOString().slice(0, 10);
    let departureTime = current.departureTime || null;

    if (istimaraIssued) {
        const appointmentMs = parseDateTimeValue(deliveryAppointmentTime);
        if (!appointmentMs) {
            return { error: 'Delivery date and time are required for the current car' };
        }
        const conflict = validateDeliveryTimeConflict(store, slot, appointmentMs, current);
        if (conflict) return conflict;
        deliveryAppointmentTime = new Date(appointmentMs).toISOString();
        departureTime = new Date(appointmentMs + SHOWROOM_DELIVERY_SLOT_MS).toISOString();
    }

    const scheduleError = validateParkingSchedule({
        istimaraIssued,
        deliveryAppointmentTime,
        replacementVin,
        expectedReplacementArrival
    });
    if (scheduleError) return scheduleError;

    const record = {
        ...current,
        showroomIstimaraIssuedDate: istimaraIssued ? showroomIstimaraIssuedDate : current.showroomIstimaraIssuedDate,
        deliveryAppointmentTime: istimaraIssued ? deliveryAppointmentTime : current.deliveryAppointmentTime,
        departureTime: istimaraIssued ? departureTime : current.departureTime,
        replacementVin,
        expectedReplacementArrival,
        controllerStatus: 'in_process',
        updatedAt: new Date().toISOString()
    };
    appendParkingRecord(store, buildParkingRecordSnapshot(store, record, 'next_car_scheduled', {
        notes: `Next car ${replacementVin} scheduled — must arrive before delivery`
    }));
    store.parkingSlots[idx] = record;
    syncShowroomVinsFromParking(store);
    return { slot: enrichParkingSlot(store, record) };
}

function clearParkingSlot(store, slotNumber) {
    const slot = Number(slotNumber);
    if (!Number.isInteger(slot) || slot < 1 || slot > SHOWROOM_PARKING_SLOTS) {
        return { error: `Parking slot must be between 1 and ${SHOWROOM_PARKING_SLOTS}` };
    }
    initShowroomParkingSlots(store);
    const current = store.parkingSlots[slot - 1];
    if (current?.showroomVin) {
        appendParkingRecord(store, buildParkingRecordSnapshot(store, current, 'cleared'));
    }
    store.parkingSlots[slot - 1] = emptyParkingSlot(slot);
    syncShowroomVinsFromParking(store);
    tryAssignQueueToSlot(store, slot);
    return { slot: enrichParkingSlot(store, store.parkingSlots[slot - 1]) };
}

function loadShowroomBoardRaw() {
    const store = loadShowroomBoardStore();
    return buildShowroomVehiclesFromStore(store);
}

function saveShowroomBoardRaw(vehicles) {
    const store = loadShowroomBoardStore();
    store.vehicles = vehicles;
    applyVinLinksToVehicles(store.vehicles, store.vinLinks);
    saveShowroomBoardStore(store);
}

function applyVinLinksToVehicles(vehicles, vinLinks) {
    (vinLinks || []).forEach((link) => {
        const showroomVin = String(link.showroomVin || '').trim().toUpperCase();
        const replacementVin = String(link.replacementVin || '').trim().toUpperCase();
        if (!showroomVin || !replacementVin) return;
        const idx = vehicles.findIndex((v) => v.vin && v.vin.toUpperCase() === showroomVin);
        if (idx < 0) return;
        const repl = vehicles.find((v) => v.vin && v.vin.toUpperCase() === replacementVin);
        vehicles[idx] = {
            ...vehicles[idx],
            replacementVin,
            replacementVehicleNumber: repl ? repl.vehicleNumber : vehicles[idx].replacementVehicleNumber,
            expectedArrivalDate: link.expectedArrivalDate ?? vehicles[idx].expectedArrivalDate,
            updatedAt: new Date().toISOString()
        };
    });
    syncShowroomReplacementLinks(vehicles);
    return vehicles;
}

function buildShowroomVehiclesFromStore(store) {
    const rows = store.salesRaw?.rows || [];
    let vehicles = [];
    if (rows.length) {
        vehicles = rows
            .map((row, i) => normalizeShowroomVehicle(row, i))
            .filter((v) => v.vehicleNumber || v.vin);
    } else if (store.vehicles?.length) {
        vehicles = store.vehicles.map((v) => ({ ...v }));
    }
    return applyVinLinksToVehicles(vehicles, store.vinLinks);
}

function rebuildShowroomVehiclesFromSalesRaw(store) {
    const rows = store.salesRaw?.rows || [];
    const normalized = rows
        .map((row, i) => normalizeShowroomVehicle(row, i))
        .filter((v) => v.vehicleNumber || v.vin);
    const byKey = new Map();
    normalized.forEach((v) => {
        const key = v.vehicleNumber || v.vin;
        byKey.set(key, v);
    });
    store.vehicles = Array.from(byKey.values());
    applyVinLinksToVehicles(store.vehicles, store.vinLinks);
    return store.vehicles;
}

function getAllRawVinEntries(store) {
    const rows = store.salesRaw?.rows || [];
    const entries = [];
    rows.forEach((row, index) => {
        const normalized = normalizeShowroomVehicle(row, index);
        const vin = String(normalized.vin || '').trim().toUpperCase();
        const vehicleNumber = String(normalized.vehicleNumber || '').trim();
        const refKey = vin || vehicleNumber.toUpperCase();
        if (!refKey) return;
        entries.push({
            refKey,
            vin,
            vehicleNumber,
            model: normalized.model,
            product: normalized.product,
            suffix: normalized.suffix,
            productLabel: formatProductSuffix(normalized),
            customerName: normalized.customerName,
            invoiceDate: normalized.invoiceDate,
            istimaraIssuedDate: normalized.istimaraIssuedDate,
            status: normalized.status,
            location: String(normalized.location || '').trim()
        });
    });
    const seen = new Set();
    return entries.filter((e) => {
        if (seen.has(e.refKey)) return false;
        seen.add(e.refKey);
        return true;
    }).sort((a, b) => a.refKey.localeCompare(b.refKey));
}

function getShowroomVinOptions(store) {
    const showroomSet = new Set((store.showroomVins || []).map((v) => String(v).toUpperCase()));
    return getAllRawVinEntries(store).filter((e) => showroomSet.has(e.refKey));
}

function setShowroomVins(store, vins) {
    const all = getAllRawVinEntries(store).map((e) => e.refKey);
    const allSet = new Set(all);
    store.showroomVins = [...new Set(
        (vins || [])
            .map((v) => String(v).trim().toUpperCase())
            .filter((v) => v && allSet.has(v))
    )].sort();
    rebuildShowroomVehiclesFromSalesRaw(store);
    return store.showroomVins;
}

function filterShowroomBoardVehicles(vehicles, showroomVins) {
    const set = new Set((showroomVins || []).map((v) => String(v).toUpperCase()));
    if (!set.size) return [];
    return vehicles.filter((v) => {
        if (v.vin && set.has(String(v.vin).toUpperCase())) return true;
        if (v.vehicleNumber && set.has(String(v.vehicleNumber).toUpperCase())) return true;
        return false;
    });
}

function deriveVehicleLocation(v, displayStatus) {
    if (v.location) return v.location;
    switch (displayStatus) {
        case 'Delivered': return 'Departed — Left Showroom';
        case 'Final Call': return 'Showroom — Final Call (Gate)';
        case 'Leaving Soon': return 'Showroom — Leaving Soon';
        case 'Invoice Created': return 'Showroom Floor — Invoiced';
        case 'Replacement Arriving': return 'In Transit — Replacement';
        case 'Delayed': return 'Delayed — Replacement Not Arrived';
        case 'Reserved': return 'Showroom — Reserved';
        default: return 'Showroom Floor';
    }
}

function upsertShowroomVinLink(store, showroomVin, replacementVin, expectedArrivalDate) {
    const sv = String(showroomVin || '').trim().toUpperCase();
    const rv = String(replacementVin || '').trim().toUpperCase();
    if (!sv) return { error: 'Showroom VIN is required' };
    if (!rv) return { error: 'Replacement VIN is required' };
    if (sv === rv) return { error: 'Showroom and replacement VIN must be different' };

    const showroomOptions = getShowroomVinOptions(store);
    const showroomSet = new Set(store.showroomVins || []);
    if (!showroomSet.has(sv)) {
        return { error: 'Showroom VIN must be marked as in showroom first' };
    }
    if (!showroomOptions.some((o) => o.refKey === sv || o.vin === sv)) {
        return { error: 'Showroom VIN not found in Sales Raw Data' };
    }

    const existingIdx = store.vinLinks.findIndex((l) => String(l.showroomVin).toUpperCase() === sv);
    const link = {
        id: existingIdx >= 0 ? store.vinLinks[existingIdx].id : `link_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        showroomVin: sv,
        replacementVin: rv,
        expectedArrivalDate: expectedArrivalDate || null,
        updatedAt: new Date().toISOString()
    };
    if (existingIdx >= 0) store.vinLinks[existingIdx] = link;
    else store.vinLinks.push(link);

    rebuildShowroomVehiclesFromSalesRaw(store);
    return { link, linkedReplacement: store.vehicles.some((v) => v.vin && v.vin.toUpperCase() === rv) };
}

function showroomStartOfDay(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function showroomSameDay(a, b) {
    if (!a || !b) return false;
    return showroomStartOfDay(a) === showroomStartOfDay(b);
}

function formatDuration(ms) {
    if (ms <= 0) return 'DEPARTED';
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function showroomPickField(input, keys) {
    for (const key of keys) {
        const val = input[key];
        if (val !== undefined && val !== null && String(val).trim() !== '') return val;
    }
    return '';
}

function showroomPickFieldFuzzy(input, explicitKeys, headerPattern) {
    const direct = showroomPickField(input, explicitKeys);
    if (direct !== '' && direct !== null && direct !== undefined) return direct;
    if (!input || typeof input !== 'object') return '';
    for (const key of Object.keys(input)) {
        if (headerPattern.test(String(key))) {
            const val = input[key];
            if (val !== undefined && val !== null && String(val).trim() !== '') return val;
        }
    }
    return '';
}

function detectSalesRawHeaderRowIndex(grid) {
    if (!Array.isArray(grid) || !grid.length) return 0;
    const salesPatterns = [/vin/i, /chassis/i, /serial/i, /model/i, /product/i, /invoice/i, /vehicle/i, /stock/i, /status/i, /order/i, /customer/i];
    let bestIdx = 0;
    let bestScore = -1;
    const scanLimit = Math.min(grid.length, 40);
    for (let i = 0; i < scanLimit; i++) {
        const row = Array.isArray(grid[i]) ? grid[i] : [];
        const cells = row.map((c) => String(c ?? '').trim()).filter(Boolean);
        if (!cells.length) continue;
        const keywordHits = cells.reduce((acc, cell) => acc + (salesPatterns.some((p) => p.test(cell)) ? 1 : 0), 0);
        const score = keywordHits * 10 + cells.length;
        if (score > bestScore) {
            bestScore = score;
            bestIdx = i;
        }
    }
    return bestIdx;
}

function parseSheetWithSalesRawHeader(worksheet) {
    const grid = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    if (!grid.length) return { headers: [], rows: [] };

    const headerRowIndex = detectSalesRawHeaderRowIndex(grid);
    const rawHeaders = (grid[headerRowIndex] || []).map((h, idx) => sanitizeHeaderName(h, idx));

    const maxCols = grid.slice(headerRowIndex).reduce((max, row) => {
        const len = Array.isArray(row) ? row.length : 0;
        return Math.max(max, len, rawHeaders.length);
    }, rawHeaders.length);

    const includedIndexes = Array.from({ length: maxCols }, (_, idx) => idx);
    const headers = makeUniqueHeaders(
        includedIndexes.map((idx) => rawHeaders[idx] || `Column_${idx + 1}`)
    );

    const rows = [];
    for (let r = headerRowIndex + 1; r < grid.length; r++) {
        const rowArr = grid[r] || [];
        const row = {};
        let hasValue = false;
        includedIndexes.forEach((idx, colIdx) => {
            const val = rowArr[idx];
            if (val !== undefined && val !== null && String(val).trim() !== '') hasValue = true;
            row[headers[colIdx]] = val ?? '';
        });
        if (hasValue) rows.push(row);
    }
    return { headers, rows };
}

function makeUniqueHeaders(headers) {
    const seen = {};
    return headers.map((header, idx) => {
        const base = String(header || '').trim() || `Column_${idx + 1}`;
        if (!seen[base]) {
            seen[base] = 1;
            return base;
        }
        seen[base]++;
        return `${base}_${seen[base]}`;
    });
}

function salesRawRowHasAnyValue(row) {
    if (!row || typeof row !== 'object') return false;
    return Object.entries(row).some(([key, val]) => {
        if (key === '_sheet') return false;
        return val !== undefined && val !== null && String(val).trim() !== '';
    });
}

function getSalesRawDataSheet(workbook) {
    const names = workbook.SheetNames || [];
    if (!names.length) return { sheetName: null, sheet: null };

    const exact = names.find((n) => /sales\s*raw\s*data/i.test(String(n)));
    if (exact) return { sheetName: exact, sheet: workbook.Sheets[exact] };

    let bestName = names[0];
    let bestSheet = workbook.Sheets[names[0]];
    let bestScore = -1;
    for (const name of names) {
        const sheet = workbook.Sheets[name];
        if (!sheet) continue;
        const parsed = parseSheetWithSalesRawHeader(sheet);
        const headerText = (parsed.headers || []).join(' ');
        let score = (parsed.rows || []).length;
        if (/vin|chassis|serial/i.test(headerText)) score += 50;
        if (/model|product|description/i.test(headerText)) score += 25;
        if (/invoice/i.test(headerText)) score += 15;
        if (/vehicle|stock|order/i.test(headerText)) score += 15;
        if (score > bestScore) {
            bestScore = score;
            bestName = name;
            bestSheet = sheet;
        }
    }
    return { sheetName: bestName, sheet: bestSheet };
}

function parseSalesRawDataRows(workbook) {
    const names = workbook.SheetNames || [];
    if (!names.length) return { sheetName: null, rows: [] };

    const allRows = [];
    names.forEach((name) => {
        const sheet = workbook.Sheets[name];
        if (!sheet) return;
        let rows = parseSheetWithSalesRawHeader(sheet).rows || [];
        if (!rows.length) {
            rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false, cellDates: true });
        }
        rows.filter(salesRawRowHasAnyValue).forEach((row) => {
            allRows.push(names.length > 1 ? { ...row, _sheet: name } : row);
        });
    });

    return {
        sheetName: names.length === 1 ? names[0] : `All Sheets (${names.length})`,
        rows: allRows
    };
}

function findRowColumnKey(row, explicitNames, headerPattern) {
    if (!row || typeof row !== 'object') return null;
    const keys = Object.keys(row);
    for (const name of explicitNames) {
        const found = keys.find((k) => String(k).toLowerCase() === String(name).toLowerCase());
        if (found) return found;
    }
    return keys.find((k) => headerPattern.test(String(k))) || null;
}

function normalizeLeadMatchKey(value) {
    if (value === null || value === undefined) return '';
    if (value instanceof Date && !isNaN(value.getTime())) return String(value.getTime());
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Number.isInteger(value) ? String(value) : String(value).replace(/\.?0+$/, '');
    }
    let s = String(value).trim();
    if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
    return s.toUpperCase().replace(/\s+/g, '');
}

function detectLeadsMatchColumns(rows, explicitNames, headerPattern) {
    if (!rows?.length) return null;
    const sample = rows.find((r) => r && typeof r === 'object') || rows[0];
    return findRowColumnKey(sample, explicitNames, headerPattern);
}

function getLeadsRawDataAllStatusSheet(workbook) {
    const names = workbook.SheetNames || [];
    let lastMatch = null;
    for (const name of names) {
        if (/raw\s*data\s*all\s*status/i.test(String(name))) {
            lastMatch = name;
        }
    }
    if (!lastMatch) return { sheetName: null, sheet: null };
    return { sheetName: lastMatch, sheet: workbook.Sheets[lastMatch] };
}

function parseLeadsInProgressRows(workbook) {
    const { sheetName, sheet } = getLeadsRawDataAllStatusSheet(workbook);
    if (!sheet) return { sheetName: null, rows: [] };
    let rows = parseSheetWithSalesRawHeader(sheet).rows || [];
    if (!rows.length) {
        rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false, cellDates: true });
    }
    rows = rows.filter(salesRawRowHasAnyValue);
    return { sheetName, rows };
}

function computeLeadsSalesMatches(store) {
    const salesRows = store.salesRaw?.rows || [];
    const leadsRows = store.leadsInProgress?.rows || [];
    if (!salesRows.length || !leadsRows.length) return [];

    const crmCol = detectLeadsMatchColumns(
        salesRows,
        ['CRM Lead ID', 'CRM Lead Id', 'CRM lead ID', 'CRM LeadID', 'CRM Lead Id.'],
        /crm\s*lead\s*id/i
    );
    const txnCol = detectLeadsMatchColumns(
        leadsRows,
        ['Transaction Number', 'Transaction No', 'Transaction #', 'Transaction No.', 'Txn Number', 'Txn No'],
        /transaction\s*(number|no\.?|#)|txn\s*(number|no\.?|#)/i
    );
    if (!crmCol || !txnCol) return [];

    const salesByKey = new Map();
    salesRows.forEach((row) => {
        const key = normalizeLeadMatchKey(row[crmCol]);
        if (!key) return;
        if (!salesByKey.has(key)) salesByKey.set(key, []);
        salesByKey.get(key).push(row);
    });

    const matches = [];
    leadsRows.forEach((leadRow) => {
        const key = normalizeLeadMatchKey(leadRow[txnCol]);
        if (!key) return;
        const salesHits = salesByKey.get(key);
        if (!salesHits?.length) return;
        salesHits.forEach((salesRow) => {
            matches.push({
                matchKey: key,
                transactionNumber: leadRow[txnCol],
                crmLeadId: salesRow[crmCol],
                leads: leadRow,
                salesRaw: salesRow
            });
        });
    });
    return matches;
}

function getOccupiedParkingVins(store, exceptSlot = null) {
    const set = new Set();
    (store.parkingSlots || []).forEach((s) => {
        if (exceptSlot && Number(s.slot) === Number(exceptSlot)) return;
        if (s.showroomVin) set.add(String(s.showroomVin).toUpperCase());
        if (s.replacementVin) set.add(String(s.replacementVin).toUpperCase());
    });
    (store.parkingQueue || []).forEach((q) => {
        if (q.status === 'waiting' && q.vin) set.add(String(q.vin).toUpperCase());
    });
    (store.arrivedCars || []).forEach((a) => {
        if (a.vin) set.add(String(a.vin).toUpperCase());
    });
    return set;
}

function getDeliveredParkingVins(store) {
    const set = new Set();
    (store.parkingRecords || []).forEach((r) => {
        if (!['departed', 'delivered', 'rotation'].includes(r.eventType)) return;
        if (r.showroomVin) set.add(String(r.showroomVin).toUpperCase());
    });
    return set;
}

function buildParkingPoolEntries(store, options = {}) {
    const { exceptSlot = null, includeVins = [] } = options;
    const occupied = getOccupiedParkingVins(store, exceptSlot);
    const delivered = getDeliveredParkingVins(store);
    const includeSet = new Set((includeVins || []).map((v) => String(v).trim().toUpperCase()).filter(Boolean));

    const matchesByVin = new Map();
    computeLeadsSalesMatches(store).forEach((m) => {
        const normalized = normalizeShowroomVehicle(m.salesRaw, 0);
        const vin = String(normalized.vin || '').trim().toUpperCase();
        if (vin && !matchesByVin.has(vin)) matchesByVin.set(vin, m);
    });

    const entries = [];
    getAllRawVinEntries(store)
        .filter((e) => e.vin)
        .forEach((e) => {
            const vin = String(e.vin).trim().toUpperCase();
            const inUseElsewhere = occupied.has(vin) && !includeSet.has(vin);
            const wasDelivered = delivered.has(vin) && !includeSet.has(vin);
            const available = !inUseElsewhere && !wasDelivered;
            const m = matchesByVin.get(vin);
            entries.push({
                vin,
                refKey: e.refKey,
                matchKey: m?.matchKey || null,
                transactionNumber: m?.transactionNumber || null,
                crmLeadId: m?.crmLeadId || null,
                vehicleNumber: e.vehicleNumber,
                model: e.model,
                product: e.product,
                suffix: e.suffix,
                productLabel: e.productLabel,
                customerName: e.customerName,
                location: e.location,
                status: e.status,
                invoiceDate: e.invoiceDate,
                available
            });
        });
    return entries.sort((a, b) => a.vin.localeCompare(b.vin));
}

function isVinInParkingPool(store, vin, exceptSlot = null, includeVin = null) {
    const target = String(vin || '').trim().toUpperCase();
    if (!target) return false;
    const include = includeVin ? [includeVin, target] : [target];
    return buildParkingPoolEntries(store, { exceptSlot, includeVins: include }).some((e) => e.vin === target);
}

function normalizeShowroomVehicle(input, index) {
    const vehicleNumber = String(
        showroomPickFieldFuzzy(input, [
            'vehicleNumber', 'Vehicle Number', 'Vehicle #', 'Vehicle No', 'Stock Number',
            'Stock No', 'Car Number', 'Unit Number', 'Unit #', 'Order Number', 'Order #'
        ], /vehicle\s*#?|stock|unit\s*#?|order\s*#?|car\s*#?/i)
    ).trim();
    const replacementVin = String(
        showroomPickFieldFuzzy(input, [
            'replacementVin', 'Replacement VIN', 'Replacement Car VIN', 'Repl VIN', 'Replacement Vin'
        ], /repl.*vin|replacement.*vin/i)
    ).trim().toUpperCase();
    const vinRaw = showroomPickFieldFuzzy(input, [
        'vin', 'VIN', 'Vin', 'Chassis', 'Chassis Number', 'Chassis No', 'VIN Number', 'Serial Number'
    ], /vin|chassis|serial/i);
    return {
        id: input.id || `veh_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
        vehicleNumber,
        model: String(showroomPickFieldFuzzy(input, ['model', 'Model', 'Vehicle Model', 'Car Model', 'Description'], /model|description/i)).trim(),
        product: String(showroomPickFieldFuzzy(input, ['product', 'Product', 'Vehicle Product', 'Car Product'], /product/i)).trim(),
        suffix: String(showroomPickFieldFuzzy(input, [
            'suffix', 'Suffix', 'Alj Suffix', 'AU Suffix', 'Trim', 'Grade'
        ], /suffix|trim|grade/i)).trim(),
        customerName: String(showroomPickFieldFuzzy(input, [
            'customerName', 'Customer Name', 'Customer', 'Client Name', 'Buyer', 'Client'
        ], /customer|client|buyer/i)).trim(),
        vin: String(vinRaw || '').trim().toUpperCase(),
        status: String(showroomPickFieldFuzzy(input, ['status', 'Status', 'Vehicle Status', 'Current Status'], /status/i) || 'Available').trim() || 'Available',
        manualStatus: input.manualStatus ? String(input.manualStatus).trim() : null,
        invoiceDate: showroomPickFieldFuzzy(input, ['invoiceDate', 'Invoice Date', 'Invoice', 'Inv Date', 'Date Invoiced'], /invoice|inv\s*date/i) || null,
        istimaraIssuedDate: showroomPickFieldFuzzy(input, [
            'istimaraIssuedDate', 'Istimara Issued Date', 'Istimara Date', 'Istimara', 'Registration Date', 'Reg Date'
        ], /istimara|registration|reg\s*date/i) || null,
        replacementVehicleNumber: String(
            showroomPickFieldFuzzy(input, ['replacementVehicleNumber', 'Replacement Vehicle', 'Replacement Vehicle Number', 'Replacement #'], /replacement/i)
        ).trim(),
        replacementVin,
        expectedArrivalDate: showroomPickFieldFuzzy(input, [
            'expectedArrivalDate', 'Expected Arrival', 'Expected Arrival Date', 'Arrival Date', 'ETA'
        ], /arrival|eta/i) || null,
        arrivalStatus: String(showroomPickFieldFuzzy(input, ['arrivalStatus', 'Arrival Status'], /arrival/i)).trim(),
        location: String(showroomPickFieldFuzzy(input, ['location', 'Location', 'Current Location', 'Yard', 'Branch', 'Site'], /location|yard|branch|site/i)).trim(),
        updatedAt: new Date().toISOString()
    };
}

function syncShowroomReplacementLinks(vehicles) {
    vehicles.forEach((v, idx) => {
        if (!v.replacementVin || v.replacementVehicleNumber) return;
        const repl = vehicles.find((x) => x.vin && x.vin.toUpperCase() === v.replacementVin.toUpperCase());
        if (repl) {
            vehicles[idx] = { ...vehicles[idx], replacementVehicleNumber: repl.vehicleNumber };
        }
    });
    return vehicles;
}

function findShowroomReplacementVehicle(vehicles, outgoing) {
    if (outgoing.replacementVehicleNumber) {
        return vehicles.find((x) => x.vehicleNumber === outgoing.replacementVehicleNumber);
    }
    if (outgoing.replacementVin) {
        const target = outgoing.replacementVin.toUpperCase();
        return vehicles.find((x) => x.vin && x.vin.toUpperCase() === target);
    }
    return null;
}

function applyParkingDisplayOverrides(vehicles, parkingSlots) {
    const byVin = new Map();
    (parkingSlots || []).forEach((s) => {
        if (s.showroomVin) byVin.set(String(s.showroomVin).toUpperCase(), s);
    });
    return (vehicles || []).map((v) => {
        const slot = v.vin && byVin.get(String(v.vin).toUpperCase());
        if (!slot) return v;
        let displayStatus = v.displayStatus;
        let rowTone = v.rowTone;
        if (slot.parkingStatus === 'Delivered') {
            displayStatus = 'Delivered';
            rowTone = 'tone-delivered';
        } else if (slot.parkingStatus === 'Delivery Booked') {
            displayStatus = 'Leaving Soon';
            rowTone = 'tone-leaving';
        } else if (slot.parkingStatus === 'Delivering') {
            displayStatus = 'Final Call';
            rowTone = 'tone-final';
        } else if (slot.parkingStatus === 'Awaiting Replacement') {
            displayStatus = 'Replacement Arriving';
            rowTone = 'tone-arriving';
        } else if (slot.parkingStatus === 'Delayed' || slot.parkingStatus === 'Confirm Delivery') {
            displayStatus = 'Delayed';
            rowTone = 'tone-delayed';
        } else if (slot.parkingStatus === 'Occupied') {
            displayStatus = v.displayStatus === 'Available' ? 'Invoice Created' : v.displayStatus;
        }
        return {
            ...v,
            displayStatus,
            rowTone,
            parkingSlot: slot.slot,
            parkingStatus: slot.parkingStatus,
            deliveryAppointmentDisplay: slot.deliveryAppointmentDisplay,
            currentLocation: deriveVehicleLocation(v, displayStatus)
        };
    });
}

function slimUploadedDataset(dataset) {
    if (!dataset) {
        return { uploadedAt: null, sheetName: null, filename: null, rowCount: 0 };
    }
    return {
        uploadedAt: dataset.uploadedAt || null,
        sheetName: dataset.sheetName || null,
        filename: dataset.filename || null,
        rowCount: Array.isArray(dataset.rows) ? dataset.rows.length : 0
    };
}

function showroomBoardPayload(store) {
    const now = Date.now();
    const rotated = applyParkingRotations(store, now);
    if (rotated) saveShowroomBoardStore(store);
    const allVehicles = buildShowroomVehiclesFromStore(store);
    const processed = processShowroomBoard(allVehicles, now);
    const parkingSlots = processParkingSlots(store, processed.serverTime);
    const leadsMatches = computeLeadsSalesMatches(store);
    const parkingPool = buildParkingPoolEntries(store);
    const availableParkingPool = parkingPool.filter((e) => e.available);
    const dashboardVehicles = applyParkingDisplayOverrides(
        filterShowroomBoardVehicles(processed.vehicles, store.showroomVins),
        parkingSlots
    );
    const dashboardStats = computeShowroomStats(dashboardVehicles, processed.serverTime);
    const parkingAlerts = [];
    parkingSlots.forEach((s) => {
        if (s.prepReminderActive) {
            parkingAlerts.push({
                slot: s.slot,
                vin: s.showroomVin,
                customerName: s.showroomCustomer,
                type: 'prep',
                message: `Parking ${s.slot}: prepare ${s.showroomProductLabel || 'vehicle'} — wash and ready for guest (1 hour before delivery)`
            });
        }
        if (s.deliveryReminderActive) {
            parkingAlerts.push({
                slot: s.slot,
                vin: s.showroomVin,
                customerName: s.showroomCustomer,
                type: 'ready',
                message: `Parking ${s.slot}: car ready for customer in 15 minutes — ${s.showroomVin}`
            });
        }
        if (s.awaitingDeliveryConfirm) {
            parkingAlerts.push({
                slot: s.slot,
                vin: s.showroomVin,
                customerName: s.showroomCustomer,
                type: 'checklist',
                message: `Parking ${s.slot}: delivery time — complete checklist`
            });
        }
    });
    const parkingQueue = (store.parkingQueue || [])
        .filter((q) => q.status === 'waiting')
        .map((q) => enrichQueueEntry(store, q));
    const parkingFull = isParkingFull(store);
    const securityCars = buildSecurityCarsList(store, processed.serverTime);
    const arrivedCars = buildArrivedCarsList(store);
    const delayedCars = buildDelayedCarsList(store, processed.serverTime);
    const leadsMatchColumns = {
        crmLeadId: detectLeadsMatchColumns(
            store.salesRaw?.rows,
            ['CRM Lead ID', 'CRM Lead Id', 'CRM lead ID', 'CRM LeadID'],
            /crm\s*lead\s*id/i
        ),
        transactionNumber: detectLeadsMatchColumns(
            store.leadsInProgress?.rows,
            ['Transaction Number', 'Transaction No', 'Transaction #', 'Txn Number'],
            /transaction\s*(number|no\.?|#)|txn\s*(number|no\.?|#)/i
        )
    };
    return {
        vehicles: dashboardVehicles,
        stats: dashboardStats,
        serverTime: processed.serverTime,
        salesRaw: slimUploadedDataset(store.salesRaw),
        leadsInProgress: slimUploadedDataset(store.leadsInProgress),
        leadsMatchCount: leadsMatches.length,
        leadsMatchColumns,
        parkingPool,
        availableParkingPool,
        vinLinks: store.vinLinks,
        showroomVins: store.showroomVins || [],
        parkingSlots,
        parkingQueue,
        parkingFull,
        securityCars,
        arrivedCars,
        delayedCars,
        parkingAlerts,
        salesRawRowCount: (store.salesRaw?.rows || []).length
    };
}

function computeShowroomStats(vehicles, now = Date.now()) {
    return {
        totalInShowroom: vehicles.filter((v) => v.displayStatus !== 'Delivered').length,
        leavingToday: vehicles.filter((v) => {
            const inv = v.invoiceDateMs;
            return inv && showroomSameDay(inv, now) && v.displayStatus !== 'Delivered';
        }).length,
        arrivalsToday: vehicles.filter((v) => v.expectedArrivalMs && showroomSameDay(v.expectedArrivalMs, now)).length,
        delayedArrivals: vehicles.filter((v) => v.displayStatus === 'Delayed').length,
        availableDisplay: vehicles.filter((v) => v.displayStatus === 'Available').length
    };
}

function processShowroomBoard(vehicles, now = Date.now()) {
    const todayStart = showroomStartOfDay(now);
    const byNumber = new Map(vehicles.map((v) => [v.vehicleNumber, v]));
    const deliveredToday = new Set();

    const processed = vehicles.map((raw) => {
        const v = { ...raw };
        let status = v.manualStatus || v.status || 'Available';
        const invoiceMs = parseDateValue(v.invoiceDate);
        const arrivalMs = parseDateValue(v.expectedArrivalDate);
        let departureAt = null;
        let timeRemainingMs = null;
        let timeRemainingLabel = '—';
        let rowTone = 'tone-available';

        if (status !== 'Delivered' && invoiceMs) {
            departureAt = invoiceMs + (24 * 60 * 60 * 1000);
            timeRemainingMs = departureAt - now;
            if (showroomSameDay(invoiceMs, now) || (departureAt > now && departureAt - invoiceMs <= 48 * 60 * 60 * 1000)) {
                if (timeRemainingMs <= 0) {
                    status = 'Delivered';
                    deliveredToday.add(v.vehicleNumber);
                } else if (timeRemainingMs <= 2 * 60 * 60 * 1000) {
                    status = 'Final Call';
                } else if (timeRemainingMs <= 8 * 60 * 60 * 1000) {
                    status = 'Leaving Soon';
                } else if (showroomSameDay(invoiceMs, now)) {
                    status = 'Invoice Created';
                }
            }
            timeRemainingLabel = timeRemainingMs > 0 ? formatDuration(timeRemainingMs) : 'DEPARTED';
        }

        if ((v.replacementVehicleNumber || v.replacementVin) && arrivalMs) {
            const arrivalDay = showroomStartOfDay(arrivalMs);
            if (arrivalDay < todayStart && status !== 'Delivered') {
                status = v.manualStatus || 'Delayed';
            } else if (arrivalDay === todayStart) {
                status = v.manualStatus || status;
                if (!v.manualStatus) status = 'Replacement Arriving';
            }
        }

        switch (status) {
            case 'Reserved': rowTone = 'tone-reserved'; break;
            case 'Invoice Created': rowTone = 'tone-invoice'; break;
            case 'Leaving Soon': rowTone = 'tone-leaving'; break;
            case 'Final Call': rowTone = 'tone-final'; break;
            case 'Delivered': rowTone = 'tone-delivered'; break;
            case 'Replacement Arriving': rowTone = 'tone-arriving'; break;
            case 'Delayed': rowTone = 'tone-delayed'; break;
            default: rowTone = 'tone-available';
        }

        return {
            ...v,
            displayStatus: status,
            currentLocation: deriveVehicleLocation(v, status),
            invoiceDateMs: invoiceMs,
            expectedArrivalMs: arrivalMs,
            departureAt,
            timeRemainingMs,
            timeRemainingLabel,
            rowTone,
            invoiceDateDisplay: invoiceMs ? new Date(invoiceMs).toLocaleDateString('en-GB') : '—',
            expectedArrivalDisplay: arrivalMs ? new Date(arrivalMs).toLocaleDateString('en-GB') : '—'
        };
    });

    processed.forEach((v) => {
        if (!deliveredToday.has(v.vehicleNumber) || (!v.replacementVehicleNumber && !v.replacementVin)) return;
        const repl = findShowroomReplacementVehicle(processed, v);
        if (repl && repl.displayStatus === 'Replacement Arriving') {
            repl.manualStatus = 'Available';
            repl.displayStatus = 'Available';
            repl.rowTone = 'tone-available';
            repl.arrivalStatus = repl.arrivalStatus || 'Arrived';
        }
    });

    const stats = {
        totalInShowroom: processed.filter((v) => v.displayStatus !== 'Delivered').length,
        leavingToday: processed.filter((v) => {
            const inv = v.invoiceDateMs;
            return inv && showroomSameDay(inv, now) && v.displayStatus !== 'Delivered';
        }).length,
        arrivalsToday: processed.filter((v) => v.expectedArrivalMs && showroomSameDay(v.expectedArrivalMs, now)).length,
        delayedArrivals: processed.filter((v) => v.displayStatus === 'Delayed').length,
        availableDisplay: processed.filter((v) => v.displayStatus === 'Available').length
    };

    return { vehicles: processed, stats, serverTime: now };
}

function authenticateShowroomRole(req, res, next) {
    const role = String(req.body?.role || req.query?.role || '').toLowerCase();
    const password = req.body?.password || req.query?.password;
    if (!SHOWROOM_ROLE_PASSWORDS[role] || password !== SHOWROOM_ROLE_PASSWORDS[role]) {
        return res.status(401).json({ error: 'Unauthorized: invalid role or password' });
    }
    req.showroomRole = role;
    next();
}

function showroomRoleCanWrite(role) {
    return role === 'uploader' || role === 'controller';
}

app.get('/api/showroom-board', (req, res) => {
    try {
        const store = loadShowroomBoardStore();
        res.json({ success: true, ...showroomBoardPayload(store) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/showroom-board/sales-raw', (req, res) => {
    try {
        const store = loadShowroomBoardStore();
        res.json({
            success: true,
            salesRaw: store.salesRaw,
            rowCount: (store.salesRaw?.rows || []).length,
            uploadedAt: store.salesRaw?.uploadedAt || null
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/showroom-board/auth', (req, res) => {
    const role = String(req.body?.role || '').toLowerCase();
    const password = req.body?.password;
    if (role === 'dashboard') {
        return res.json({ success: true, role: 'dashboard' });
    }
    if (SHOWROOM_ROLE_PASSWORDS[role] && password === SHOWROOM_ROLE_PASSWORDS[role]) {
        return res.json({ success: true, role });
    }
    res.status(401).json({ error: 'Invalid role or password' });
});

app.post('/api/showroom-board/import', authenticateShowroomRole, (req, res) => {
    try {
        if (!showroomRoleCanWrite(req.showroomRole)) {
            return res.status(403).json({ error: 'Forbidden for this role' });
        }
        const incoming = Array.isArray(req.body?.vehicles) ? req.body.vehicles : [];
        const normalized = incoming.map((row, i) => normalizeShowroomVehicle(row, i)).filter((v) => v.vehicleNumber);
        const existing = req.body?.replace ? [] : loadShowroomBoardRaw();
        const merged = [...existing];
        normalized.forEach((row) => {
            const idx = merged.findIndex((v) => v.vehicleNumber === row.vehicleNumber);
            if (idx >= 0) merged[idx] = { ...merged[idx], ...row, id: merged[idx].id };
            else merged.push(row);
        });
        saveShowroomBoardRaw(merged);
        broadcastShowroomUpdate();
        res.json({ success: true, imported: normalized.length, total: merged.length, ...processShowroomBoard(merged) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/showroom-board/vehicles/:id', authenticateShowroomRole, (req, res) => {
    try {
        if (req.showroomRole !== 'controller') {
            return res.status(403).json({ error: 'Only Showroom Controller can edit vehicles' });
        }
        const vehicles = loadShowroomBoardRaw();
        const idx = vehicles.findIndex((v) => v.id === req.params.id);
        if (idx < 0) return res.status(404).json({ error: 'Vehicle not found' });
        vehicles[idx] = { ...vehicles[idx], ...req.body, id: vehicles[idx].id, updatedAt: new Date().toISOString() };
        saveShowroomBoardRaw(vehicles);
        broadcastShowroomUpdate();
        res.json({ success: true, ...processShowroomBoard(vehicles) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/showroom-board/vehicles', authenticateShowroomRole, (req, res) => {
    try {
        if (!showroomRoleCanWrite(req.showroomRole)) {
            return res.status(403).json({ error: 'Forbidden for this role' });
        }
        const vehicles = loadShowroomBoardRaw();
        const row = normalizeShowroomVehicle(req.body, vehicles.length);
        if (!row.vehicleNumber) return res.status(400).json({ error: 'Vehicle Number is required' });
        const idx = vehicles.findIndex((v) => v.vehicleNumber === row.vehicleNumber);
        if (idx >= 0) vehicles[idx] = { ...vehicles[idx], ...row, id: vehicles[idx].id };
        else vehicles.push(row);
        saveShowroomBoardRaw(vehicles);
        broadcastShowroomUpdate();
        res.json({ success: true, ...processShowroomBoard(vehicles) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/showroom-board/import-sales-raw', authenticateShowroomRole, express.json({ limit: '25mb' }), (req, res) => {
    try {
        if (req.showroomRole !== 'uploader') {
            return res.status(403).json({ error: 'Only Data Uploader can upload Sales Raw Data' });
        }
        const { fileData, filename } = req.body || {};
        if (!fileData) return res.status(400).json({ error: 'fileData is required' });
        const base64Data = String(fileData).startsWith('data:') ? String(fileData).split(',')[1] : String(fileData);
        const workbook = XLSX.read(Buffer.from(base64Data, 'base64'), { type: 'buffer', cellDates: true });
        const { sheetName, rows } = parseSalesRawDataRows(workbook);
        if (!rows.length) {
            return res.status(400).json({ error: 'Sales Raw Data sheet is empty or not found in workbook' });
        }
        const store = loadShowroomBoardStore();
        store.salesRaw = {
            uploadedAt: new Date().toISOString(),
            sheetName,
            filename: filename || 'Sales Raw Data',
            rows
        };
        rebuildShowroomVehiclesFromSalesRaw(store);
        saveShowroomBoardStore(store);
        broadcastShowroomUpdate();
        const matches = computeLeadsSalesMatches(store);
        res.json({
            success: true,
            sheetName,
            imported: rows.length,
            leadsMatchCount: matches.length,
            salesRaw: store.salesRaw,
            ...showroomBoardPayload(store)
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/showroom-board/import-leads-in-progress', authenticateShowroomRole, express.json({ limit: '25mb' }), (req, res) => {
    try {
        if (req.showroomRole !== 'uploader') {
            return res.status(403).json({ error: 'Only Data Uploader can upload Leads in Progress' });
        }
        const { fileData, filename } = req.body || {};
        if (!fileData) return res.status(400).json({ error: 'fileData is required' });
        const base64Data = String(fileData).startsWith('data:') ? String(fileData).split(',')[1] : String(fileData);
        const workbook = XLSX.read(Buffer.from(base64Data, 'base64'), { type: 'buffer', cellDates: true });
        const { sheetName, rows } = parseLeadsInProgressRows(workbook);
        if (!sheetName) {
            return res.status(400).json({ error: 'Sheet "raw data all status" not found in workbook' });
        }
        if (!rows.length) {
            return res.status(400).json({ error: 'Leads in Progress sheet is empty' });
        }
        const store = loadShowroomBoardStore();
        store.leadsInProgress = {
            uploadedAt: new Date().toISOString(),
            sheetName,
            filename: filename || 'Leads in Progress',
            rows
        };
        saveShowroomBoardStore(store);
        broadcastShowroomUpdate();
        const matches = computeLeadsSalesMatches(store);
        res.json({
            success: true,
            sheetName,
            imported: rows.length,
            leadsInProgress: store.leadsInProgress,
            leadsMatchCount: matches.length,
            ...showroomBoardPayload(store)
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/showroom-board/showroom-vins', authenticateShowroomRole, (req, res) => {
    try {
        if (req.showroomRole !== 'controller') {
            return res.status(403).json({ error: 'Only Showroom Controller can set showroom VINs' });
        }
        const store = loadShowroomBoardStore();
        const vins = Array.isArray(req.body?.vins) ? req.body.vins : [];
        setShowroomVins(store, vins);
        saveShowroomBoardStore(store);
        broadcastShowroomUpdate();
        res.json({
            success: true,
            showroomVins: store.showroomVins,
            count: store.showroomVins.length,
            ...showroomBoardPayload(store)
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/showroom-board/vin-link', authenticateShowroomRole, (req, res) => {
    try {
        if (req.showroomRole !== 'controller') {
            return res.status(403).json({ error: 'Only Showroom Controller can link VINs' });
        }
        const store = loadShowroomBoardStore();
        const result = upsertShowroomVinLink(
            store,
            req.body?.showroomVin,
            req.body?.replacementVin,
            req.body?.expectedArrivalDate ?? null
        );
        if (result.error) return res.status(400).json({ error: result.error });
        saveShowroomBoardStore(store);
        broadcastShowroomUpdate();
        res.json({
            success: true,
            link: result.link,
            linkedReplacement: result.linkedReplacement,
            ...showroomBoardPayload(store)
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/showroom-board/vin-link/:id', authenticateShowroomRole, (req, res) => {
    try {
        if (req.showroomRole !== 'controller') {
            return res.status(403).json({ error: 'Only Showroom Controller can remove VIN links' });
        }
        const store = loadShowroomBoardStore();
        store.vinLinks = store.vinLinks.filter((l) => l.id !== req.params.id);
        rebuildShowroomVehiclesFromSalesRaw(store);
        saveShowroomBoardStore(store);
        broadcastShowroomUpdate();
        res.json({ success: true, ...showroomBoardPayload(store) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/showroom-board/records', (req, res) => {
    try {
        const store = loadShowroomBoardStore();
        res.json({
            success: true,
            records: (store.parkingRecords || []).slice(0, 500)
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

function filterParkingRecordsForDay(records, dayMs = Date.now()) {
    const start = showroomStartOfDay(dayMs);
    const end = start + 86400000;
    return (records || []).filter((r) => {
        const t = Date.parse(r.recordedAt);
        return !isNaN(t) && t >= start && t < end;
    });
}

app.get('/api/showroom-board/records/export', (req, res) => {
    try {
        const store = loadShowroomBoardStore();
        const dateParam = String(req.query.date || '').trim();
        const dayMs = dateParam ? Date.parse(dateParam) : Date.now();
        const dayLabel = new Date(dayMs).toISOString().slice(0, 10);
        const rows = filterParkingRecordsForDay(store.parkingRecords || [], dayMs).map((r) => ({
            Recorded: r.recordedAt ? new Date(r.recordedAt).toLocaleString('en-GB') : '',
            Parking: r.slot ? `P${r.slot}` : '',
            Event: r.eventType || '',
            'Kanban Status': r.kanbanStatus || '',
            Status: r.controllerStatus || '',
            'Showroom VIN': r.showroomVin || '',
            Product: r.showroomProduct || '',
            Suffix: r.showroomSuffix || '',
            Customer: r.showroomCustomer || '',
            Location: r.showroomLocation || '',
            Istimara: r.showroomIstimara || '',
            'Delivery Time': r.deliveryAppointmentTime ? new Date(r.deliveryAppointmentTime).toLocaleString('en-GB') : (r.departureTime ? new Date(r.departureTime).toLocaleString('en-GB') : ''),
            'Gate Entrance': r.securityEntranceAt ? new Date(r.securityEntranceAt).toLocaleString('en-GB') : '',
            'Istimara Verified At': r.securityIstimaraVerifiedAt ? new Date(r.securityIstimaraVerifiedAt).toLocaleString('en-GB') : (r.securityIstimaraVerified ? 'Yes' : ''),
            'Not Damaged': r.checklistNotDamaged === true ? 'Yes' : r.checklistNotDamaged === false ? 'No' : (r.securityNotDamaged === true ? 'Yes' : r.securityNotDamaged === false ? 'No' : ''),
            Washed: r.checklistWashed === true ? 'Yes' : r.checklistWashed === false ? 'No' : '',
            'Stickers Removed': r.checklistStickersRemoved === true ? 'Yes' : r.checklistStickersRemoved === false ? 'No' : '',
            Plated: r.checklistPlated === true ? 'Yes' : r.checklistPlated === false ? 'No' : '',
            'Car Arrived': r.checklistCarArrived === true ? 'Yes' : r.checklistCarArrived === false ? 'No' : '',
            Notes: r.notes || ''
        }));
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{
            Recorded: '', Parking: '', Event: '', 'Showroom VIN': '', Notes: 'No records for this day'
        }]);
        XLSX.utils.book_append_sheet(wb, ws, 'Parking Records');
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="showroom-parking-${dayLabel}.xlsx"`);
        res.send(buf);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/showroom-board/parking/:slot', authenticateShowroomRole, (req, res) => {
    try {
        if (req.showroomRole !== 'controller') {
            return res.status(403).json({ error: 'Only Showroom Controller can manage parking' });
        }
        const store = loadShowroomBoardStore();
        const result = upsertParkingSlot(store, req.params.slot, req.body || {});
        if (result.error) return res.status(400).json({ error: result.error });
        saveShowroomBoardStore(store);
        broadcastShowroomUpdate();
        res.json({ success: true, parkingSlot: result.slot, ...showroomBoardPayload(store) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/showroom-board/parking/:slot/quick-assign', authenticateShowroomRole, (req, res) => {
    try {
        if (req.showroomRole !== 'controller') {
            return res.status(403).json({ error: 'Only Showroom Controller can manage parking' });
        }
        const store = loadShowroomBoardStore();
        const result = quickAssignParkingSlot(store, req.params.slot, req.body?.showroomVin, req.body || {});
        if (result.error) return res.status(400).json({ error: result.error });
        saveShowroomBoardStore(store);
        broadcastShowroomUpdate();
        res.json({ success: true, parkingSlot: result.slot, ...showroomBoardPayload(store) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/showroom-board/parking/:slot/next-car', authenticateShowroomRole, (req, res) => {
    try {
        if (req.showroomRole !== 'controller') {
            return res.status(403).json({ error: 'Only Showroom Controller can manage parking' });
        }
        const store = loadShowroomBoardStore();
        const result = addNextCarToParkingSlot(store, req.params.slot, req.body || {});
        if (result.error) return res.status(400).json({ error: result.error });
        saveShowroomBoardStore(store);
        broadcastShowroomUpdate();
        res.json({ success: true, parkingSlot: result.slot, ...showroomBoardPayload(store) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/showroom-board/parking/:slot/confirm-delivery', authenticateShowroomRole, (req, res) => {
    try {
        if (req.showroomRole !== 'controller') {
            return res.status(403).json({ error: 'Only Showroom Controller can confirm delivery' });
        }
        const store = loadShowroomBoardStore();
        const result = confirmParkingDelivery(store, req.params.slot, req.body || {});
        if (result.error) return res.status(400).json({ error: result.error });
        saveShowroomBoardStore(store);
        broadcastShowroomUpdate();
        res.json({ success: true, parkingSlot: result.slot, ...showroomBoardPayload(store) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/showroom-board/queue', authenticateShowroomRole, (req, res) => {
    try {
        if (req.showroomRole !== 'controller') {
            return res.status(403).json({ error: 'Only Showroom Controller can manage the queue' });
        }
        const store = loadShowroomBoardStore();
        const result = addParkingQueueEntry(store, req.body?.vin);
        if (result.error) return res.status(400).json({ error: result.error });
        saveShowroomBoardStore(store);
        broadcastShowroomUpdate();
        res.json({ success: true, queueEntry: result.entry, targetSlot: result.targetSlot, ...showroomBoardPayload(store) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/showroom-board/queue/:id', authenticateShowroomRole, (req, res) => {
    try {
        if (req.showroomRole !== 'controller') {
            return res.status(403).json({ error: 'Only Showroom Controller can manage the queue' });
        }
        const store = loadShowroomBoardStore();
        if (!Array.isArray(store.parkingQueue)) store.parkingQueue = [];
        const before = store.parkingQueue.length;
        store.parkingQueue = store.parkingQueue.filter((q) => q.id !== req.params.id);
        if (store.parkingQueue.length === before) {
            return res.status(404).json({ error: 'Queue entry not found' });
        }
        saveShowroomBoardStore(store);
        broadcastShowroomUpdate();
        res.json({ success: true, ...showroomBoardPayload(store) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/showroom-board/parking/:slot/reschedule-delayed', authenticateShowroomRole, (req, res) => {
    try {
        if (req.showroomRole !== 'controller') {
            return res.status(403).json({ error: 'Only Showroom Controller can reschedule delayed cars' });
        }
        const store = loadShowroomBoardStore();
        const result = rescheduleDelayedParking(store, req.params.slot, req.body || {});
        if (result.error) return res.status(400).json({ error: result.error });
        saveShowroomBoardStore(store);
        broadcastShowroomUpdate();
        res.json({ success: true, parkingSlot: result.slot, ...showroomBoardPayload(store) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/showroom-board/security/entrance', authenticateShowroomRole, (req, res) => {
    try {
        if (req.showroomRole !== 'security') {
            return res.status(403).json({ error: 'Only Security can log car entrance' });
        }
        const store = loadShowroomBoardStore();
        const result = submitSecurityEntrance(store, req.body?.vin);
        if (result.error) return res.status(400).json({ error: result.error });
        saveShowroomBoardStore(store);
        broadcastShowroomUpdate();
        res.json({ success: true, parkingSlot: result.slot, ...showroomBoardPayload(store) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/showroom-board/security/verify-istimara', authenticateShowroomRole, (req, res) => {
    try {
        if (req.showroomRole !== 'security') {
            return res.status(403).json({ error: 'Only Security can verify Istimara' });
        }
        const store = loadShowroomBoardStore();
        const result = submitSecurityIstimaraVerify(store, req.body?.vin);
        if (result.error) return res.status(400).json({ error: result.error });
        saveShowroomBoardStore(store);
        broadcastShowroomUpdate();
        res.json({ success: true, parkingSlot: result.slot, ...showroomBoardPayload(store) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/showroom-board/parking/:slot', authenticateShowroomRole, (req, res) => {
    try {
        if (req.showroomRole !== 'controller') {
            return res.status(403).json({ error: 'Only Showroom Controller can manage parking' });
        }
        const store = loadShowroomBoardStore();
        const result = clearParkingSlot(store, req.params.slot);
        if (result.error) return res.status(400).json({ error: result.error });
        saveShowroomBoardStore(store);
        broadcastShowroomUpdate();
        res.json({ success: true, parkingSlot: result.slot, ...showroomBoardPayload(store) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/showroom-board/upload-excel', authenticateShowroomRole, express.raw({ type: '*/*', limit: '25mb' }), (req, res) => {
    try {
        if (!showroomRoleCanWrite(req.showroomRole)) {
            return res.status(403).json({ error: 'Forbidden for this role' });
        }
        const workbook = XLSX.read(req.body, { type: 'buffer', cellDates: true });
        const { sheetName, rows } = parseSalesRawDataRows(workbook);
        if (!rows.length) {
            return res.status(400).json({ error: 'Sales Raw Data sheet is empty or not found' });
        }
        const normalized = rows.map((row, i) => normalizeShowroomVehicle(row, i)).filter((v) => v.vehicleNumber);
        const replace = String(req.query.replace || 'false') === 'true';
        const existing = replace ? [] : loadShowroomBoardRaw();
        const merged = [...existing];
        normalized.forEach((row) => {
            const idx = merged.findIndex((v) => v.vehicleNumber === row.vehicleNumber);
            if (idx >= 0) merged[idx] = { ...merged[idx], ...row, id: merged[idx].id };
            else merged.push(row);
        });
        saveShowroomBoardRaw(merged);
        broadcastShowroomUpdate();
        res.json({
            success: true,
            sheetName,
            imported: normalized.length,
            total: merged.length,
            ...processShowroomBoard(merged)
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ——— Delivery note inventory (VIN picker for مذكرة ترحيل) ———
function loadDeliveryInventoryStore() {
    const empty = {
        raw: { uploadedAt: null, filename: null, sheetName: null, rows: [] },
        vehicles: [],
        queue: [],
        drafts: [],
        updatedAt: null
    };
    try {
        if (fs.existsSync(DELIVERY_INVENTORY_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(DELIVERY_INVENTORY_FILE, 'utf8'));
            return {
                ...empty,
                ...parsed,
                raw: { ...empty.raw, ...(parsed.raw || {}) },
                vehicles: Array.isArray(parsed.vehicles) ? parsed.vehicles : [],
                queue: Array.isArray(parsed.queue) ? parsed.queue : [],
                drafts: Array.isArray(parsed.drafts) ? parsed.drafts : []
            };
        }
    } catch (e) {
        console.error('Delivery inventory load error:', e.message);
    }
    return { ...empty };
}

function saveDeliveryInventoryStore(store) {
    store.updatedAt = new Date().toISOString();
    fs.writeFileSync(DELIVERY_INVENTORY_FILE, JSON.stringify(store, null, 2));
    if (typeof broadcastDeliveryHubUpdate === 'function') {
        broadcastDeliveryHubUpdate();
    }
}

function buildDeliveryInventoryVehicle(row, index) {
    const normalized = normalizeShowroomVehicle(row, index);
    const product = normalized.product || normalized.model || '';
    const model = normalized.model || product;
    const plate = String(
        showroomPickFieldFuzzy(row, [
            'plate', 'Plate', 'Plate No', 'Plate Number', 'License Plate', 'PlateNo'
        ], /plate|لوحة/i)
    ).trim();
    const gt = String(
        showroomPickFieldFuzzy(row, ['gt', 'GT', 'GT No', 'Gate', 'Gate No'], /\bgt\b|gate/i)
    ).trim() || normalized.vehicleNumber || '';
    return {
        id: normalized.id,
        vin: normalized.vin,
        chassis: normalized.vin,
        product,
        model,
        suffix: normalized.suffix || '',
        plate,
        gt,
        customerName: normalized.customerName || '',
        location: normalized.location || '',
        imageUrl: resolveToyotaCarImage(product || model)
    };
}

function rebuildDeliveryInventoryVehicles(store) {
    const rows = store.raw?.rows || [];
    store.vehicles = rows
        .map((row, i) => buildDeliveryInventoryVehicle(row, i))
        .filter((v) => v.vin);
    return store;
}

function deliveryInventoryDashboard(store) {
    const vehicles = store.vehicles || [];
    const productCounts = {};
    vehicles.forEach((v) => {
        const key = v.product || v.model || '—';
        productCounts[key] = (productCounts[key] || 0) + 1;
    });
    const topProducts = Object.entries(productCounts)
        .map(([product, count]) => ({ product, count }))
        .sort((a, b) => b.count - a.count || a.product.localeCompare(b.product))
        .slice(0, 12);
    return {
        totalVehicles: vehicles.length,
        uniqueProducts: Object.keys(productCounts).length,
        topProducts,
        uploadedAt: store.raw?.uploadedAt || null,
        filename: store.raw?.filename || null,
        sheetName: store.raw?.sheetName || null,
        updatedAt: store.updatedAt || null
    };
}

function searchDeliveryInventoryVehicles(store, search, excludeVins = []) {
    const q = String(search || '').trim().toLowerCase();
    const excluded = new Set((excludeVins || []).map((v) => String(v).toUpperCase()));
    let list = (store.vehicles || []).filter((v) => !excluded.has(v.vin));
    if (q) {
        list = list.filter((v) => {
            const hay = [v.vin, v.product, v.model, v.suffix, v.plate, v.customerName, v.location]
                .join(' ')
                .toLowerCase();
            return hay.includes(q);
        });
    }
    return list;
}

app.get('/api/delivery-inventory', (req, res) => {
    try {
        const store = loadDeliveryInventoryStore();
        res.json({
            success: true,
            dashboard: deliveryInventoryDashboard(store),
            vehicles: store.vehicles.slice(0, 500)
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/delivery-inventory/vehicles', (req, res) => {
    try {
        const store = loadDeliveryInventoryStore();
        const search = req.query.search || req.query.q || '';
        const exclude = req.query.exclude
            ? String(req.query.exclude).split(',').map((s) => s.trim()).filter(Boolean)
            : [];
        const limit = Math.min(parseInt(req.query.limit, 10) || 80, 200);
        const vehicles = searchDeliveryInventoryVehicles(store, search, exclude).slice(0, limit);
        res.json({
            success: true,
            total: store.vehicles.length,
            count: vehicles.length,
            vehicles
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/delivery-inventory/upload', express.json({ limit: '25mb' }), (req, res) => {
    try {
        const { fileData, filename } = req.body || {};
        if (!fileData) return res.status(400).json({ error: 'fileData is required' });
        const base64Data = String(fileData).startsWith('data:')
            ? String(fileData).split(',')[1]
            : String(fileData);
        const workbook = XLSX.read(Buffer.from(base64Data, 'base64'), { type: 'buffer', cellDates: true });
        const { sheetName, rows } = parseSalesRawDataRows(workbook);
        if (!rows.length) {
            return res.status(400).json({ error: 'No vehicle rows found in workbook' });
        }
        const store = loadDeliveryInventoryStore();
        store.raw = {
            uploadedAt: new Date().toISOString(),
            sheetName,
            filename: filename || 'Sales Raw Data',
            rows
        };
        rebuildDeliveryInventoryVehicles(store);
        saveDeliveryInventoryStore(store);
        res.json({
            success: true,
            imported: rows.length,
            sheetName,
            dashboard: deliveryInventoryDashboard(store)
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/delivery-inventory', (req, res) => {
    try {
        const store = {
            raw: { uploadedAt: null, filename: null, sheetName: null, rows: [] },
            vehicles: [],
            queue: [],
            drafts: [],
            updatedAt: new Date().toISOString()
        };
        saveDeliveryInventoryStore(store);
        res.json({ success: true, dashboard: deliveryInventoryDashboard(store) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const DELIVERY_AGENTS = ['ياسين', 'الفاضل', 'البراء'];
const DELIVERY_AGENT_PASSWORD = '1234';

function parseDeliveryVinList(input) {
    if (Array.isArray(input)) {
        return input.map((v) => String(v).trim()).filter(Boolean);
    }
    return String(input || '')
        .split(/[\s,;\n\r\t]+/)
        .map((s) => s.trim())
        .filter(Boolean);
}

function lookupDeliveryVehicleByVin(store, vin) {
    const target = String(vin || '').trim().toUpperCase();
    if (!target) return null;
    return (store.vehicles || []).find((v) => v.vin === target) || null;
}

function enrichDeliveryQueueItem(store, item) {
    const vehicle = lookupDeliveryVehicleByVin(store, item.vin);
    const enriched = {
        ...item,
        product: vehicle?.product || '',
        model: vehicle?.model || '',
        gt: vehicle?.gt || '',
        location: vehicle?.location || '',
        plate: vehicle?.plate || '',
        imageUrl: vehicle?.imageUrl || null
    };
    enriched.statusLabel = getDeliveryAgentStatusLabel(enriched);
    return enriched;
}

const DELIVERY_AGENT_STATUSES = ['in_stock', 'ready_for_delivery', 'out_of_delivery', 'delivered'];

function getDeliveryAgentStatusLabel(item) {
    if (item.status !== 'claimed' || !item.agentStatus) return null;
    if (item.agentStatus === 'delivered') return 'تم الترحيل';
    if (item.agentStatus === 'in_stock' && item.assignedTo) {
        return `مع ${item.assignedTo}`;
    }
    if (item.agentStatus === 'ready_for_delivery') return 'Ready';
    if (item.agentStatus === 'out_of_delivery') return 'Out for delivery';
    return null;
}

function deliveryQueueStats(store) {
    const queue = store.queue || [];
    return {
        total: queue.length,
        available: queue.filter((q) => q.status === 'available').length,
        claimed: queue.filter((q) => q.status === 'claimed').length,
        in_stock: queue.filter((q) => q.agentStatus === 'in_stock').length,
        ready_for_delivery: queue.filter((q) => q.agentStatus === 'ready_for_delivery').length,
        out_of_delivery: queue.filter((q) => q.agentStatus === 'out_of_delivery').length,
        delivered: queue.filter((q) => q.agentStatus === 'delivered').length,
        drafts: (store.drafts || []).length
    };
}

function assertDeliveryAgent(username, password) {
    if (!DELIVERY_AGENTS.includes(String(username || '').trim())) {
        return { error: 'اسم المستخدم غير مسموح' };
    }
    if (String(password || '') !== DELIVERY_AGENT_PASSWORD) {
        return { error: 'كلمة المرور غير صحيحة' };
    }
    return { username: String(username).trim() };
}

app.post('/api/delivery-coordinator/auth', express.json(), (req, res) => {
    try {
        const auth = assertDeliveryAgent(req.body?.username, req.body?.password);
        if (auth.error) return res.status(401).json({ error: auth.error });
        res.json({ success: true, username: auth.username, agents: DELIVERY_AGENTS });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/delivery-coordinator/queue', (req, res) => {
    try {
        const store = loadDeliveryInventoryStore();
        const username = String(req.query.username || '').trim();
        const admin = req.query.admin === '1';
        const availableOnly = req.query.availableOnly === '1';
        let queue = (store.queue || []).map((item) => enrichDeliveryQueueItem(store, item));
        if (!admin && username && DELIVERY_AGENTS.includes(username)) {
            queue = queue.filter((item) =>
                item.status === 'available' ||
                (item.assignedTo === username && item.agentStatus !== 'delivered')
            );
            if (availableOnly) {
                queue = queue.filter((item) => item.status === 'available');
            }
        }
        res.json({
            success: true,
            queue,
            drafts: admin ? (store.drafts || []) : [],
            agents: DELIVERY_AGENTS,
            stats: deliveryQueueStats(store),
            rawUploaded: Boolean(store.raw?.rows?.length)
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/delivery-coordinator/drafts/:id', (req, res) => {
    try {
        const id = String(req.params.id || '').trim();
        if (!id) return res.status(400).json({ error: 'Draft id is required' });
        const store = loadDeliveryInventoryStore();
        const draft = (store.drafts || []).find((d) => d.id === id);
        if (!draft) return res.status(404).json({ error: 'Draft not found' });
        res.json({ success: true, draft });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/delivery-coordinator/submit-vins', express.json(), (req, res) => {
    try {
        const vins = parseDeliveryVinList(req.body?.vins).map((v) => v.toUpperCase());
        if (!vins.length) return res.status(400).json({ error: 'No VINs provided' });
        const store = loadDeliveryInventoryStore();
        if (!Array.isArray(store.queue)) store.queue = [];
        const existing = new Set(store.queue.map((q) => q.vin));
        let added = 0;
        vins.forEach((vin) => {
            if (existing.has(vin)) return;
            store.queue.push({
                id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                vin,
                addedAt: new Date().toISOString(),
                addedBy: 'coordinator',
                assignedTo: null,
                assignedAt: null,
                agentStatus: null,
                status: 'available'
            });
            existing.add(vin);
            added++;
        });
        saveDeliveryInventoryStore(store);
        res.json({
            success: true,
            added,
            skipped: vins.length - added,
            stats: deliveryQueueStats(store),
            queue: store.queue.map((item) => enrichDeliveryQueueItem(store, item))
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/delivery-coordinator/claim', express.json(), (req, res) => {
    try {
        const auth = assertDeliveryAgent(req.body?.username, req.body?.password);
        if (auth.error) return res.status(401).json({ error: auth.error });
        const vin = String(req.body?.vin || '').trim().toUpperCase();
        const agentStatus = String(req.body?.agentStatus || '').trim();
        if (!vin) return res.status(400).json({ error: 'VIN is required' });
        if (!DELIVERY_AGENT_STATUSES.includes(agentStatus)) {
            return res.status(400).json({ error: 'agentStatus must be in_stock, ready_for_delivery, or out_of_delivery' });
        }
        const store = loadDeliveryInventoryStore();
        const item = (store.queue || []).find((q) => q.vin === vin);
        if (!item) return res.status(404).json({ error: 'VIN not found in coordinator queue' });
        if (item.status === 'claimed' && item.assignedTo && item.assignedTo !== auth.username) {
            return res.status(409).json({ error: `VIN already claimed by ${item.assignedTo}` });
        }
        item.status = 'claimed';
        item.assignedTo = auth.username;
        item.agentStatus = agentStatus;
        item.assignedAt = new Date().toISOString();
        saveDeliveryInventoryStore(store);
        res.json({ success: true, item: enrichDeliveryQueueItem(store, item) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/delivery-coordinator/set-status', express.json(), (req, res) => {
    try {
        const auth = assertDeliveryAgent(req.body?.username, req.body?.password);
        if (auth.error) return res.status(401).json({ error: auth.error });
        const vin = String(req.body?.vin || '').trim().toUpperCase();
        const agentStatus = String(req.body?.agentStatus || '').trim();
        if (!vin) return res.status(400).json({ error: 'VIN is required' });
        if (!DELIVERY_AGENT_STATUSES.includes(agentStatus)) {
            return res.status(400).json({ error: 'Invalid agentStatus' });
        }
        const store = loadDeliveryInventoryStore();
        const item = (store.queue || []).find((q) => q.vin === vin);
        if (!item) return res.status(404).json({ error: 'VIN not found in coordinator queue' });
        if (item.status !== 'claimed' || item.assignedTo !== auth.username) {
            return res.status(403).json({ error: 'Not your assigned vehicle' });
        }
        item.agentStatus = agentStatus;
        item.assignedAt = new Date().toISOString();
        if (agentStatus === 'delivered') {
            item.deliveredAt = new Date().toISOString();
        }
        saveDeliveryInventoryStore(store);
        res.json({ success: true, item: enrichDeliveryQueueItem(store, item) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/delivery-coordinator/complete-print', express.json(), (req, res) => {
    try {
        const auth = assertDeliveryAgent(req.body?.username, req.body?.password);
        if (auth.error) return res.status(401).json({ error: auth.error });
        const vin = String(req.body?.vin || '').trim().toUpperCase();
        const draftPayload = req.body?.draft || req.body?.payload || null;
        if (!vin) return res.status(400).json({ error: 'VIN is required' });
        const store = loadDeliveryInventoryStore();
        const item = (store.queue || []).find((q) => q.vin === vin);
        if (!item) return res.status(404).json({ error: 'VIN not found in coordinator queue' });
        if (item.assignedTo !== auth.username) {
            return res.status(403).json({ error: 'Not your assigned vehicle' });
        }
        if (!Array.isArray(store.drafts)) store.drafts = [];
        const enriched = enrichDeliveryQueueItem(store, item);
        const draft = {
            id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            vin,
            assignedTo: auth.username,
            printedAt: new Date().toISOString(),
            product: enriched.product,
            model: enriched.model,
            gt: enriched.gt,
            location: enriched.location,
            customerName: draftPayload?.customer_name || '',
            payload: draftPayload
        };
        store.drafts.unshift(draft);
        if (store.drafts.length > 500) store.drafts.length = 500;
        item.agentStatus = 'out_of_delivery';
        item.printedAt = draft.printedAt;
        item.draftId = draft.id;
        saveDeliveryInventoryStore(store);
        res.json({
            success: true,
            item: enrichDeliveryQueueItem(store, item),
            draft
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/delivery-coordinator/release', express.json(), (req, res) => {
    try {
        const vin = String(req.body?.vin || '').trim().toUpperCase();
        const store = loadDeliveryInventoryStore();
        const item = (store.queue || []).find((q) => q.vin === vin);
        if (!item) return res.status(404).json({ error: 'VIN not found' });
        item.status = 'available';
        item.assignedTo = null;
        item.assignedAt = null;
        item.agentStatus = null;
        saveDeliveryInventoryStore(store);
        res.json({ success: true, item: enrichDeliveryQueueItem(store, item) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/delivery-coordinator/queue/:vin', (req, res) => {
    try {
        const vin = String(req.params.vin || '').trim().toUpperCase();
        const store = loadDeliveryInventoryStore();
        const before = (store.queue || []).length;
        store.queue = (store.queue || []).filter((q) => q.vin !== vin);
        if (store.queue.length === before) {
            return res.status(404).json({ error: 'VIN not found in queue' });
        }
        saveDeliveryInventoryStore(store);
        res.json({ success: true, stats: deliveryQueueStats(store) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Start HTTP server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
    console.log(`🔐 Admin password: 1234`);
    console.log(`✈️ Showroom Flight Board hub: /showroom-flight-board.html`);
    console.log(`   Dashboard: /showroom-dashboard.html · Uploader: /showroom-uploader.html · Controller: /showroom-controller.html`);
    console.log(`   Uploader password: ${SHOWROOM_ROLE_PASSWORDS.uploader}`);
    console.log(`   Controller password: ${SHOWROOM_ROLE_PASSWORDS.controller}`);
    console.log(`   Security password: ${SHOWROOM_ROLE_PASSWORDS.security}`);
    if (process.env.RAILWAY_ENVIRONMENT || process.env.RENDER || process.env.FLY_APP_NAME) {
        console.log(`🌐 App is running in the cloud and accessible from anywhere!`);
    }
});

// WebSocket for real-time updates (attach to HTTP server for cloud compatibility)
const wss = new WebSocket.Server({ server });

let broadcastDeliveryHubUpdate = function broadcastDeliveryHubUpdate() {
    try {
        const store = loadDeliveryInventoryStore();
        const message = JSON.stringify({
            type: 'delivery_hub_updated',
            updatedAt: store.updatedAt,
            stats: deliveryQueueStats(store)
        });
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) client.send(message);
        });
    } catch (e) {
        console.error('Delivery hub broadcast error:', e.message);
    }
};

const SHOWROOM_LIVE_TICK_MS = 5000;
let showroomLiveTickCount = 0;

broadcastShowroomUpdate = function broadcastShowroomUpdate() {
    try {
        const store = loadShowroomBoardStore();
        const data = showroomBoardPayload(store);
        const message = JSON.stringify({ type: 'showroom_updated', data });
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) client.send(message);
        });
    } catch (e) {
        console.error('Showroom broadcast error:', e.message);
    }
};

setInterval(() => {
    try {
        const store = loadShowroomBoardStore();
        const changed = applyParkingRotations(store, Date.now());
        if (changed) saveShowroomBoardStore(store);
        showroomLiveTickCount += 1;
        broadcastShowroomUpdate();
    } catch (e) {
        console.error('Showroom live tick error:', e.message);
    }
}, SHOWROOM_LIVE_TICK_MS);

function broadcastUpdate() {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const message = JSON.stringify({ type: 'data_updated', data });
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Queue management - Employee System
const QUEUE_FILE = path.join(__dirname, 'queue-data.json');

// Employee passwords (for employees 1-8)
const EMPLOYEE_PASSWORDS = {
    '1': '1111',
    '2': '1111',
    '3': '1111',
    '4': '1111',
    '5': '1111',
    '6': '1111',
    '7': '1111',
    '8': '1111'
};

// Sales Advisor passwords (for advisors S1-S8)
const ADVISOR_PASSWORDS = {
    'S1': '1111',
    'S2': '1111',
    'S3': '1111',
    'S4': '1111',
    'S5': '1111',
    'S6': '1111',
    'S7': '1111',
    'S8': '1111'
};

// Advisor name to ID and password mapping
const ADVISOR_NAME_TO_ID = {
    'ali': { id: 'S1', password: '48476', name: 'ali' },
    'muteb': { id: 'S2', password: '50345', name: 'muteb' },
    'lujain': { id: 'S3', password: '50093', name: 'lujain' },
    'al jawhara': { id: 'S4', password: '48448', name: 'al jawhara' },
    'eissa': { id: 'S5', password: '45646', name: 'eissa' },
    'kholod': { id: 'S6', password: '46662', name: 'kholod' },
    'haneen': { id: 'S7', password: '49601', name: 'haneen' },
    'raoom': { id: 'S8', password: '46643', name: 'raoom' }
};

// Default advisor names (displayed even when not logged in)
const DEFAULT_ADVISOR_NAMES = {
    'S1': 'ali',
    'S2': 'muteb',
    'S3': 'lujain',
    'S4': 'al jawhara',
    'S5': 'eissa',
    'S6': 'kholod',
    'S7': 'haneen',
    'S8': 'raoom'
};

// Helper function to get advisor info from name
function getAdvisorInfoFromName(name) {
    return ADVISOR_NAME_TO_ID[name.toLowerCase()] || null;
}

// Helper function to get default advisor name for ID
function getDefaultAdvisorName(advisorId) {
    return DEFAULT_ADVISOR_NAMES[advisorId] || `Sales Advisor ${advisorId}`;
}

// Helper function to get advisor name for logging (checks default names, then advisor object)
function getAdvisorNameForLogging(advisorId, password) {
    // Use default name if available
    const defaultName = getDefaultAdvisorName(advisorId);
    if (defaultName && !defaultName.startsWith('Sales Advisor')) {
        return defaultName;
    }
    // Fallback to advisor name from queue data
    const queueData = getQueueData();
    const advisor = queueData.employees.find(e => e.id === String(advisorId) && e.type === 'advisor');
    return advisor ? (advisor.displayName || advisor.name) : defaultName || advisorId;
}

// User passwords (for users 11-16 - customers)
const USER_PASSWORDS = {
    '11': '1111',
    '12': '1111',
    '13': '1111',
    '14': '1111',
    '15': '1111',
    '16': '1111'
};

// Initialize queue data file with employees and sales advisors if it doesn't exist
if (!fs.existsSync(QUEUE_FILE)) {
    const initialEmployees = [
        { id: '1', name: 'Employee 1', status: 'available', updatedAt: new Date().toISOString(), updatedBy: 'system' },
        { id: '2', name: 'Employee 2', status: 'available', updatedAt: new Date().toISOString(), updatedBy: 'system' },
        { id: '3', name: 'Employee 3', status: 'available', updatedAt: new Date().toISOString(), updatedBy: 'system' },
        { id: '4', name: 'Employee 4', status: 'available', updatedAt: new Date().toISOString(), updatedBy: 'system' },
        { id: '5', name: 'Employee 5', status: 'available', updatedAt: new Date().toISOString(), updatedBy: 'system' },
        { id: '6', name: 'Employee 6', status: 'available', updatedAt: new Date().toISOString(), updatedBy: 'system' },
        { id: '7', name: 'Employee 7', status: 'available', updatedAt: new Date().toISOString(), updatedBy: 'system' },
        { id: '8', name: 'Employee 8', status: 'available', updatedAt: new Date().toISOString(), updatedBy: 'system' },
        // Sales Advisors (default to out_of_office - must log in to change status)
        { id: 'S1', name: 'ali', status: 'out_of_office', updatedAt: new Date().toISOString(), updatedBy: 'system', type: 'advisor', dailyCustomersCount: 0 },
        { id: 'S2', name: 'muteb', status: 'out_of_office', updatedAt: new Date().toISOString(), updatedBy: 'system', type: 'advisor', dailyCustomersCount: 0 },
        { id: 'S3', name: 'lujain', status: 'out_of_office', updatedAt: new Date().toISOString(), updatedBy: 'system', type: 'advisor', dailyCustomersCount: 0 },
        { id: 'S4', name: 'al jawhara', status: 'out_of_office', updatedAt: new Date().toISOString(), updatedBy: 'system', type: 'advisor', dailyCustomersCount: 0 },
        { id: 'S5', name: 'eissa', status: 'out_of_office', updatedAt: new Date().toISOString(), updatedBy: 'system', type: 'advisor', dailyCustomersCount: 0 },
        { id: 'S6', name: 'kholod', status: 'out_of_office', updatedAt: new Date().toISOString(), updatedBy: 'system', type: 'advisor', dailyCustomersCount: 0 },
        { id: 'S7', name: 'haneen', status: 'out_of_office', updatedAt: new Date().toISOString(), updatedBy: 'system', type: 'advisor', dailyCustomersCount: 0 },
        { id: 'S8', name: 'raoom', status: 'out_of_office', updatedAt: new Date().toISOString(), updatedBy: 'system', type: 'advisor', dailyCustomersCount: 0 }
    ];
    fs.writeFileSync(QUEUE_FILE, JSON.stringify({ employees: initialEmployees, customers: [], waitingList: [] }, null, 2));
}

// Helper function to read queue data
function getQueueData() {
    try {
        const data = fs.readFileSync(QUEUE_FILE, 'utf8');
        const parsed = JSON.parse(data);
        // Ensure we have customers array
        if (!parsed.customers) {
            parsed.customers = [];
        }
        // Ensure we have waitingList array
        if (!parsed.waitingList) {
            parsed.waitingList = [];
        }
        // Ensure we have waitingArea
        if (!parsed.waitingArea) {
            parsed.waitingArea = {
                id: 'WAITING_AREA',
                name: 'Waiting Area',
                customers: []
            };
        }
        if (!parsed.waitingArea.customers) {
            parsed.waitingArea.customers = [];
        }
        // Ensure we have 8 employees
        if (!parsed.employees) {
            parsed.employees = [];
        }
        
        const existingIds = new Set(parsed.employees.map(e => e.id));
        
        // Add employees 1-8 if missing
        for (let i = 1; i <= 8; i++) {
            if (!existingIds.has(String(i))) {
                parsed.employees.push({
                    id: String(i),
                    name: `Employee ${i}`,
                    status: 'available',
                    updatedAt: new Date().toISOString(),
                    updatedBy: 'system'
                });
            }
        }
        
        // Add sales advisors S1-S8 if missing, or update with default names
        const advisorIds = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];
        advisorIds.forEach(advisorId => {
            const defaultName = getDefaultAdvisorName(advisorId);
            if (!existingIds.has(advisorId)) {
                const existing = parsed.employees.find(e => e.id === advisorId);
                if (!existing) {
                    parsed.employees.push({
                        id: advisorId,
                        name: defaultName,
                        status: 'out_of_office', // Default to out_of_office - must log in to change
                        updatedAt: new Date().toISOString(),
                        updatedBy: 'system',
                        type: 'advisor',
                        dailyCustomersCount: 0
                    });
                } else if (!existing.dailyCustomersCount) {
                    existing.dailyCustomersCount = 0;
                    existing.type = 'advisor';
                }
            } else {
                // Ensure existing advisors have default names and out_of_office status if not logged in
                const advisor = parsed.employees.find(e => e.id === advisorId && e.type === 'advisor');
                if (advisor) {
                    if (!advisor.assignedAdvisorId && (!advisor.name || advisor.name.startsWith('Sales Advisor'))) {
                        advisor.name = defaultName;
                    }
                    // If advisor is not logged in (no assignedAdvisorId), set status to out_of_office
                    if (!advisor.assignedAdvisorId && advisor.status !== 'out_of_office') {
                        advisor.status = 'out_of_office';
                    }
                }
            }
        });
        
        // Reset daily counts if it's a new day (use getSaudiDateString for consistency)
        const today = getSaudiDateString();
        parsed.employees.forEach(emp => {
            if (emp.type === 'advisor') {
                if (!emp.lastResetDate || emp.lastResetDate !== today) {
                    emp.dailyCustomersCount = 0;
                    emp.lastResetDate = today;
                }
            }
        });
        
        if (existingIds.size !== parsed.employees.length) {
            saveQueueData(parsed);
        }
        
        return parsed;
    } catch (error) {
        return { employees: [], customers: [], waitingList: [] };
    }
}

// Helper function to save queue data
function saveQueueData(data) {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(data, null, 2));
}

// Helper function to get Saudi Arabia time (UTC+3)
function getSaudiTime() {
    const now = new Date();
    // Saudi Arabia is UTC+3
    const saudiOffset = 3 * 60; // 3 hours in minutes
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const saudiTime = new Date(utc + (saudiOffset * 60000));
    return saudiTime;
}

// Helper function to format Saudi time as ISO string
function getSaudiTimeString() {
    return getSaudiTime().toISOString();
}

// Helper function to get Saudi date string (YYYY-MM-DD)
function getSaudiDateString() {
    const saudiTime = getSaudiTime();
    const year = saudiTime.getUTCFullYear();
    const month = String(saudiTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(saudiTime.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Helper function to get Saudi time string (HH:MM:SS)
function getSaudiTimeOnly() {
    const saudiTime = getSaudiTime();
    const hours = String(saudiTime.getUTCHours()).padStart(2, '0');
    const minutes = String(saudiTime.getUTCMinutes()).padStart(2, '0');
    const seconds = String(saudiTime.getUTCSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

// Legacy function names for backward compatibility (now use Saudi time)
function getLocalTime() {
    return getSaudiTime();
}

function getLocalTimeString() {
    return getSaudiTimeString();
}

function getLocalDateString() {
    return getSaudiDateString();
}

function getLocalTimeOnly() {
    return getSaudiTimeOnly();
}

// Helper function to log actions
function logAction(action) {
    try {
        let logs = [];
        if (fs.existsSync(QUEUE_LOG_FILE)) {
            const logData = fs.readFileSync(QUEUE_LOG_FILE, 'utf8');
            logs = JSON.parse(logData);
        }
        
        const saudiTime = getSaudiTime();
        const logEntry = {
            timestamp: saudiTime.toISOString(),
            date: getSaudiDateString(),
            time: getSaudiTimeOnly(),
            ...action
        };
        
        logs.push(logEntry);
        fs.writeFileSync(QUEUE_LOG_FILE, JSON.stringify(logs, null, 2));
    } catch (error) {
        console.error('Error logging action:', error);
    }
}

// Helper function to get queue log
function getQueueLog() {
    try {
        if (fs.existsSync(QUEUE_LOG_FILE)) {
            const logData = fs.readFileSync(QUEUE_LOG_FILE, 'utf8');
            return JSON.parse(logData);
        }
        return [];
    } catch (error) {
        console.error('Error reading queue log:', error);
        return [];
    }
}

// Helper function to recalculate waiting numbers for all advisors
function recalculateWaitingNumbers(queueData) {
    if (!queueData.waitingList) return;
    
    const advisorIds = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];
    
    advisorIds.forEach(advisorId => {
        const advisorWaiting = queueData.waitingList
            .filter(w => w.advisorId === advisorId && w.status === 'waiting')
            .sort((a, b) => {
                // Sort by creation time to maintain order
                return new Date(a.createdAt) - new Date(b.createdAt);
            });
        
        // Reassign waiting numbers sequentially
        advisorWaiting.forEach((customer, index) => {
            customer.waitingNumber = index + 1;
        });
    });
}

// Round-robin assignment tracker (stored in queueData)
function getLastAssignedAdvisor(queueData) {
    return queueData.lastAssignedAdvisorIndex || 0;
}

function setLastAssignedAdvisor(queueData, index) {
    queueData.lastAssignedAdvisorIndex = index;
}

// Helper function to check if advisor has any customer (assigned, waiting, or active)
function advisorHasCustomer(queueData, advisorId) {
    // Check if advisor has any ASSIGNED customers (not yet accepted)
    const hasAssigned = (queueData.waitingList || []).some(w => 
        w.advisorId === advisorId && w.status === 'assigned'
    );
    
    // Check if advisor has any waiting customers
    const hasWaiting = (queueData.waitingList || []).some(w => 
        w.advisorId === advisorId && w.status === 'waiting'
    );
    
    // Check if advisor has any active customers
    const hasActive = (queueData.customers || []).some(c => 
        c.employeeId === advisorId && (c.status === 'active' || c.status === 'accepted') && !c.completedAt
    );
    
    return hasAssigned || hasWaiting || hasActive;
}

// Helper function to auto-assign customer using round-robin (one by one)
// IMPORTANT: Only assigns to advisors who are SIGNED IN and have NO customers (waiting or active)
function autoAssignAdvisor(queueData, advisorIds = ['S1', 'S2', 'S3', 'S4']) {
    // Get only signed-in, available advisors with NO customers
    // Advisor must have assignedAdvisorId set (meaning they are signed in)
    const availableAdvisors = advisorIds.filter(advisorId => {
        const advisor = queueData.employees.find(e => e.id === advisorId && e.type === 'advisor');
        if (!advisor) {
            return false;
        }
        // Check if advisor is signed in (has assignedAdvisorId)
        if (!advisor.assignedAdvisorId) {
            return false; // Advisor not signed in
        }
        // Check if advisor status is 'available'
        if (advisor.status !== 'available') {
            return false;
        }
        // Check if advisor has NO customers (waiting or active)
        return !advisorHasCustomer(queueData, advisorId);
    });
    
    if (availableAdvisors.length === 0) {
        // If no advisors available with no customers, return null (will go to waiting area)
        return null;
    }
    
    // Round-robin: get last assigned index and assign to next advisor
    let lastIndex = getLastAssignedAdvisor(queueData);
    
    // Find the next available advisor starting from lastIndex
    let assignedIndex = -1;
    for (let i = 0; i < availableAdvisors.length; i++) {
        const checkIndex = (lastIndex + i) % availableAdvisors.length;
        const advisorId = availableAdvisors[checkIndex];
        const advisor = queueData.employees.find(e => e.id === advisorId && e.type === 'advisor');
        if (advisor && advisor.status === 'available' && !advisorHasCustomer(queueData, advisorId)) {
            assignedIndex = checkIndex;
            break;
        }
    }
    
    if (assignedIndex === -1) {
        assignedIndex = 0; // Fallback to first available
    }
    
    // Update last assigned index
    setLastAssignedAdvisor(queueData, assignedIndex);
    
    return availableAdvisors[assignedIndex];
}

// Function to extract oldest customer from waiting area when advisor becomes available
function extractFromWaitingArea(queueData, advisorId) {
    // Check if advisor is signed in
    const advisor = queueData.employees.find(e => e.id === advisorId && e.type === 'advisor');
    if (!advisor || !advisor.assignedAdvisorId) {
        return; // Advisor not signed in, don't assign
    }
    
    // Check if advisor already has a customer
    if (advisorHasCustomer(queueData, advisorId)) {
        return; // Advisor already has a customer, don't assign more
    }
    
    if (!queueData.waitingArea || !queueData.waitingArea.customers) {
        return;
    }
    
    const waitingAreaCustomers = queueData.waitingArea.customers.filter(c => c.status === 'waiting');
    if (waitingAreaCustomers.length === 0) {
        return;
    }
    
    // Sort by creation time to get oldest first (FIFO)
    waitingAreaCustomers.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    
    // Extract oldest customer
    const oldestCustomer = waitingAreaCustomers[0];
    oldestCustomer.advisorId = advisorId;
    oldestCustomer.status = 'assigned'; // ASSIGNED status (ready for advisor to accept)
    oldestCustomer.assignedAt = getSaudiTimeString();
    oldestCustomer.assignedBy = 'advisor'; // Track that this was assigned by advisor (from waiting area)
    
    // Remove from waiting area
    const index = queueData.waitingArea.customers.findIndex(c => c.id === oldestCustomer.id);
    if (index >= 0) {
        queueData.waitingArea.customers.splice(index, 1);
    }
    
    // Add to advisor's waiting list (status = ASSIGNED)
    if (!queueData.waitingList) {
        queueData.waitingList = [];
    }
    queueData.waitingList.push(oldestCustomer);
    
    // Don't increment count here - count only when customer is ACCEPTED
    // This prevents double-counting (assignment + acceptance)
    
    // Log extraction (advisor already found above)
    const advisorName = advisor ? (advisor.displayName || advisor.name) : advisorId;
    
    logAction({
        action: 'customer_extracted_from_waiting_area',
        customerId: oldestCustomer.id,
        customerName: oldestCustomer.customerName,
        customerPhone: oldestCustomer.customerPhone || '',
        advisorId: advisorId,
        advisorName: advisorName,
        assignedAt: oldestCustomer.assignedAt,
        assignedBy: 'advisor', // Track assignment source
        originalAssignedBy: oldestCustomer.assignedBy || 'promoter' // Preserve original assignment source
    });
    
    recalculateWaitingNumbers(queueData);
}

// Function to redistribute waiting customers when an advisor becomes available
function redistributeCustomersToAvailableAdvisor(queueData, newlyAvailableAdvisorId) {
    const advisorIds = ['S1', 'S2', 'S3', 'S4'];
    
    // Get all waiting customers from all advisors
    const allWaitingCustomers = (queueData.waitingList || []).filter(
        w => w.status === 'waiting'
    );
    
    if (allWaitingCustomers.length === 0) {
        return; // No customers to redistribute
    }
    
    // Get all available advisors
    const availableAdvisors = advisorIds.filter(advisorId => {
        const advisor = queueData.employees.find(e => e.id === advisorId && e.type === 'advisor');
        return advisor && advisor.status === 'available';
    });
    
    if (availableAdvisors.length === 0) {
        return; // No available advisors
    }
    
    // Calculate current queue counts for each available advisor
    const advisorCounts = availableAdvisors.map(advisorId => {
        const waitingCount = allWaitingCustomers.filter(
            w => w.advisorId === advisorId
        ).length;
        
        const activeCount = (queueData.customers || []).filter(
            c => c.employeeId === advisorId && 
                 c.status === 'accepted' && 
                 !c.completedAt
        ).length;
        
        return {
            advisorId: advisorId,
            waitingCount: waitingCount,
            activeCount: activeCount,
            totalCount: waitingCount + activeCount
        };
    });
    
    // Find the newly available advisor's current count
    const newlyAvailableCount = advisorCounts.find(a => a.advisorId === newlyAvailableAdvisorId);
    if (!newlyAvailableCount) {
        return; // Advisor not found
    }
    
    // Calculate average count across all available advisors
    const totalWorkload = advisorCounts.reduce((sum, a) => sum + a.totalCount, 0);
    const averageCount = totalWorkload / availableAdvisors.length;
    
    // Find advisors with more customers than the newly available advisor
    const advisorsWithMoreCustomers = advisorCounts
        .filter(a => a.advisorId !== newlyAvailableAdvisorId && a.totalCount > newlyAvailableCount.totalCount)
        .sort((a, b) => b.totalCount - a.totalCount); // Sort by count descending
    
    if (advisorsWithMoreCustomers.length === 0) {
        return; // No advisors have more customers, already balanced
    }
    
    // Calculate how many customers to transfer to balance
    // Transfer enough to bring the newly available advisor closer to average
    const targetCount = Math.ceil(averageCount);
    const needed = Math.max(0, targetCount - newlyAvailableCount.totalCount);
    
    if (needed <= 0) {
        return; // Already at or above target
    }
    
    // Get all waiting customers from advisors with more customers
    const customersToTransfer = allWaitingCustomers.filter(
        w => advisorsWithMoreCustomers.some(a => a.advisorId === w.advisorId)
    );
    
    // Shuffle customers randomly to select which ones to transfer
    const shuffledCustomers = [...customersToTransfer].sort(() => Math.random() - 0.5);
    
    // Transfer customers until we reach the target or run out
    let reassignedCount = 0;
    for (const customer of shuffledCustomers) {
        if (reassignedCount >= needed) break;
        
        const oldAdvisorId = customer.advisorId;
        customer.advisorId = newlyAvailableAdvisorId;
        customer.assignedAt = getSaudiTimeString();
        
        // Get advisor names for logging
        const oldAdvisor = queueData.employees.find(e => e.id === oldAdvisorId && e.type === 'advisor');
        const newAdvisor = queueData.employees.find(e => e.id === newlyAvailableAdvisorId && e.type === 'advisor');
        
        // Log the reassignment
        logAction({
            action: 'customer_auto_reassigned',
            customerId: customer.id,
            customerName: customer.customerName,
            oldAdvisorId: oldAdvisorId,
            oldAdvisorName: oldAdvisor ? (oldAdvisor.displayName || oldAdvisor.name) : oldAdvisorId,
            newAdvisorId: newlyAvailableAdvisorId,
            newAdvisorName: newAdvisor ? (newAdvisor.displayName || newAdvisor.name) : newlyAvailableAdvisorId,
            reason: 'advisor_became_available',
            reassignedAt: customer.assignedAt
        });
        
        reassignedCount++;
    }
    
    // Recalculate waiting numbers for all advisors after all transfers
    recalculateWaitingNumbers(queueData);
}

// Helper function to broadcast queue updates
function broadcastQueueUpdate() {
    const queueData = getQueueData();
    const message = JSON.stringify({ type: 'queue_updated', data: queueData });
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Helper function to broadcast alerts
function broadcastAlert(alert) {
    const message = JSON.stringify({ type: 'alert', data: alert });
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Helper function to check waiting times and generate alerts
function checkWaitingTimes() {
    try {
        const queueData = getQueueData();
        const waitingList = queueData.waitingList || [];
        const now = new Date();
        const FIVE_MINUTES = 5 * 60 * 1000; // 5 minutes in milliseconds
        const alerts = [];
        
        waitingList.forEach((customer) => {
            if (customer.status === 'waiting' && customer.createdAt) {
                const waitTime = now - new Date(customer.createdAt);
                
                if (waitTime > FIVE_MINUTES && !customer.waitExceeded5Min) {
                    // Mark customer as escalated (don't remove)
                    customer.waitExceeded5Min = true;
                    customer.escalatedAt = now.toISOString();
                    
                    const advisor = queueData.employees.find(e => e.id === customer.advisorId && e.type === 'advisor');
                    const advisorName = advisor ? (advisor.displayName || advisor.name) : customer.advisorId;
                    
                    const alert = {
                        type: 'customer_waiting_escalated',
                        customerId: customer.id,
                        customerName: customer.customerName,
                        customerPhone: customer.customerPhone,
                        advisorId: customer.advisorId,
                        advisorName: advisorName,
                        waitTimeMinutes: Math.round(waitTime / 60000),
                        createdAt: customer.createdAt,
                        escalatedAt: now.toISOString(),
                        message: `Customer "${customer.customerName}" has been waiting for more than 5 minutes with ${advisorName}.`
                    };
                    
                    alerts.push(alert);
                    
                    // Log the escalation (not removal)
                    logAction({
                        action: 'customer_waiting_escalated',
                        customerId: customer.id,
                        customerName: customer.customerName,
                        customerPhone: customer.customerPhone || 'N/A',
                        advisorId: customer.advisorId,
                        advisorName: advisorName,
                        waitTimeMinutes: Math.round(waitTime / 60000),
                        escalatedAt: getSaudiTimeString(),
                        waitExceeded5Min: true,
                        handledByAdmin: false
                    });
                }
            }
        });
        
        // Check waiting area customers
        const waitingAreaCustomers = (queueData.waitingArea && queueData.waitingArea.customers) || [];
        waitingAreaCustomers.forEach((customer) => {
            if (customer.status === 'waiting' && customer.createdAt) {
                const waitTime = now - new Date(customer.createdAt);
                
                if (waitTime > FIVE_MINUTES && !customer.waitExceeded5Min) {
                    // Mark customer as escalated (don't remove)
                    customer.waitExceeded5Min = true;
                    customer.escalatedAt = now.toISOString();
                    
                    const alert = {
                        type: 'customer_waiting_escalated',
                        customerId: customer.id,
                        customerName: customer.customerName,
                        customerPhone: customer.customerPhone,
                        advisorId: 'WAITING_AREA',
                        advisorName: 'Waiting Area',
                        waitTimeMinutes: Math.round(waitTime / 60000),
                        createdAt: customer.createdAt,
                        escalatedAt: now.toISOString(),
                        message: `Customer "${customer.customerName}" has been waiting for more than 5 minutes in waiting area.`
                    };
                    
                    alerts.push(alert);
                    
                    // Log the escalation (not removal)
                    logAction({
                        action: 'customer_waiting_escalated',
                        customerId: customer.id,
                        customerName: customer.customerName,
                        customerPhone: customer.customerPhone || 'N/A',
                        advisorId: 'WAITING_AREA',
                        advisorName: 'Waiting Area',
                        waitTimeMinutes: Math.round(waitTime / 60000),
                        escalatedAt: getSaudiTimeString(),
                        waitExceeded5Min: true,
                        handledByAdmin: false
                    });
                }
            }
        });
        
        // Save changes if any customers were escalated
        if (alerts.length > 0) {
            saveQueueData(queueData);
            
            // Broadcast alerts to all connected clients
            alerts.forEach(alert => {
                broadcastAlert(alert);
            });
            
            // Broadcast queue update
            broadcastQueueUpdate();
        }
        
        return alerts;
    } catch (error) {
        console.error('Error checking waiting times:', error);
        return [];
    }
}

// Function to check for customers assigned but not accepted within 3 minutes
function checkAssignedCustomersTimeout() {
    try {
        const queueData = getQueueData();
        const waitingList = queueData.waitingList || [];
        const now = new Date();
        const THREE_MINUTES = 3 * 60 * 1000; // 3 minutes in milliseconds
        let customersReturned = false;
        
        // Find customers with status 'assigned' that have been assigned for more than 3 minutes
        const assignedCustomers = waitingList.filter(c => 
            c.status === 'assigned' && c.assignedAt
        );
        
        assignedCustomers.forEach((customer) => {
            const assignedTime = new Date(customer.assignedAt);
            const timeSinceAssigned = now - assignedTime;
            
            if (timeSinceAssigned > THREE_MINUTES) {
                // Store original values before clearing
                const originalCreatedAt = customer.createdAt;
                const originalAdvisorId = customer.advisorId;
                const originalAssignedAt = customer.assignedAt;
                
                // Find advisor before clearing fields (for logging)
                const advisor = queueData.employees.find(e => 
                    e.id === originalAdvisorId && e.type === 'advisor'
                );
                const advisorName = advisor ? (advisor.displayName || advisor.name) : originalAdvisorId || 'Unknown';
                
                // Remove from advisor's waiting list
                const index = waitingList.findIndex(c => c.id === customer.id);
                if (index >= 0) {
                    waitingList.splice(index, 1);
                }
                
                // Clear advisor's active customer if this was their assigned customer
                if (advisor && advisor.activeCustomerId === customer.id) {
                    advisor.activeCustomerId = null;
                }
                
                // Clear assignment-related fields
                customer.assignedAdvisorId = null;
                customer.assignedAt = null;
                customer.acceptedAt = null;
                customer.employeeId = null;
                customer.advisorId = 'WAITING_AREA';
                customer.status = 'waiting';
                
                // Preserve original createdAt for FIFO ordering
                customer.createdAt = originalCreatedAt;
                
                // Add back to waiting area
                if (!queueData.waitingArea) {
                    queueData.waitingArea = {
                        id: 'WAITING_AREA',
                        name: 'Waiting Area',
                        customers: []
                    };
                }
                if (!queueData.waitingArea.customers) {
                    queueData.waitingArea.customers = [];
                }
                queueData.waitingArea.customers.push(customer);
                
                // Sort waiting area by createdAt to maintain FIFO order
                queueData.waitingArea.customers.sort((a, b) => 
                    new Date(a.createdAt) - new Date(b.createdAt)
                );
                
                // Log the return to waiting area
                logAction({
                    action: 'customer_returned_to_waiting_area_timeout',
                    customerId: customer.id,
                    customerName: customer.customerName,
                    customerPhone: customer.customerPhone || 'N/A',
                    advisorId: originalAdvisorId || 'Unknown',
                    advisorName: advisorName,
                    assignedAt: originalAssignedAt,
                    returnedAt: getLocalTimeString(),
                    reason: 'Not accepted within 3 minutes'
                });
                
                customersReturned = true;
            }
        });
        
        // Recalculate waiting numbers if customers were returned
        if (customersReturned) {
            recalculateWaitingNumbers(queueData);
            saveQueueData(queueData);
            broadcastQueueUpdate();
        }
        
        return customersReturned;
    } catch (error) {
        console.error('Error checking assigned customers timeout:', error);
        return false;
    }
}

// Function to check for advisors who haven't updated status in 5 minutes and auto-logout
function checkAdvisorStatusTimeout() {
    try {
        const queueData = getQueueData();
        const now = new Date();
        const TWO_MINUTES = 2 * 60 * 1000; // 2 minutes in milliseconds (changed from 5 to 2)
        let advisorsAutoLoggedOut = false;
        
        const advisors = (queueData.employees || []).filter(e => e.type === 'advisor' && e.assignedAdvisorId);
        
        advisors.forEach(advisor => {
            if (advisor.lastStatusUpdate) {
                const timeSinceUpdate = now - new Date(advisor.lastStatusUpdate);
                
                if (timeSinceUpdate > TWO_MINUTES) {
                    // Auto-logout: set status to out_of_office and clear assignedAdvisorId
                    const oldStatus = advisor.status;
                    advisor.status = 'out_of_office';
                    advisor.assignedAdvisorId = null;
                    advisor.lastStatusUpdate = null;
                    advisorsAutoLoggedOut = true;
                    
                    // Log auto-logout
                    logAction({
                        action: 'advisor_auto_logged_out',
                        advisorId: advisor.id,
                        advisorName: advisor.displayName || advisor.name,
                        reason: 'no_status_update_2_minutes',
                        oldStatus: oldStatus,
                        timestamp: now.toISOString()
                    });
                }
            }
        });
        
        if (advisorsAutoLoggedOut) {
            saveQueueData(queueData);
            broadcastQueueUpdate();
        }
        
        return advisorsAutoLoggedOut;
    } catch (error) {
        console.error('Error checking advisor status timeout:', error);
        return false;
    }
}

// Start monitoring waiting times (check every 30 seconds)
setInterval(() => {
    checkWaitingTimes();
}, 30000);

// Start monitoring advisor status timeouts (check every 30 seconds)
setInterval(() => {
    checkAdvisorStatusTimeout();
}, 30000); // Check every 30 seconds

// Start monitoring assigned customers timeout (check every 30 seconds)
setInterval(() => {
    checkAssignedCustomersTimeout();
}, 30000); // Check every 30 seconds

// API: Get queue status
app.get('/api/queue', (req, res) => {
    try {
        const queueData = getQueueData();
        res.json(queueData);
    } catch (error) {
        console.error('Error getting queue data:', error);
        res.status(500).json({ error: 'Failed to get queue data' });
    }
});

// API: Employee sign in and update status
app.post('/api/queue/employee/signin', (req, res) => {
    try {
        const { employeeId, password, status, customerName, customerPhone } = req.body;
        
        if (!employeeId || !password) {
            return res.status(400).json({ error: 'employeeId and password are required' });
        }
        
        // Verify password
        if (EMPLOYEE_PASSWORDS[employeeId] !== password) {
            return res.status(401).json({ error: 'Invalid password' });
        }
        
        if (status && !['available', 'busy'].includes(status)) {
            return res.status(400).json({ error: 'status must be "available", "busy", or "out_of_office"' });
        }
        
        // If marking busy, require customer info
        if (status === 'busy' && (!customerName || !customerPhone)) {
            return res.status(400).json({ error: 'Customer name and phone are required when marking busy' });
        }
        
        const queueData = getQueueData();
        
        // Find employee
        let employeeIndex = queueData.employees.findIndex(e => e.id === String(employeeId));
        
        if (employeeIndex === -1) {
            // Create new employee entry
            queueData.employees.push({
                id: String(employeeId),
                name: `Employee ${employeeId}`,
                status: status || 'available',
                updatedAt: new Date().toISOString(),
                updatedBy: `employee_${employeeId}`
            });
            employeeIndex = queueData.employees.length - 1;
        } else {
            // Update employee status
            if (status) {
                const oldStatus = queueData.employees[employeeIndex].status;
                queueData.employees[employeeIndex].status = status;
                
                // If changing from available to busy, create customer record
                if (oldStatus === 'available' && status === 'busy' && customerName && customerPhone) {
                    const customer = {
                        id: `customer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        employeeId: String(employeeId),
                        customerName: customerName,
                        customerPhone: customerPhone,
                        createdAt: getSaudiTimeString(),
                        assignedAt: getSaudiTimeString(),
                        createdBy: `employee_${employeeId}`,
                        status: 'active'
                    };
                    queueData.customers.push(customer);
                }
                // If changing from busy to available, mark current customer as completed
                else if (oldStatus === 'busy' && status === 'available') {
                    const activeCustomer = queueData.customers.find(c => 
                        c.employeeId === String(employeeId) && !c.completedAt);
                    if (activeCustomer) {
                        activeCustomer.completedAt = getSaudiTimeString();
                        activeCustomer.status = 'completed';
                    }
                }
                
                // If advisor became available (from busy or out_of_office), clear active customer
                // NOTE: Advisor must manually press "Next" to get next customer from waiting area
                const employee = queueData.employees[employeeIndex];
                if (employee.type === 'advisor' && status === 'available' && (oldStatus === 'busy' || oldStatus === 'out_of_office')) {
                    employee.activeCustomerId = null; // Clear active customer
                    // Do NOT automatically extract from waiting area - advisor must press "Next"
                }
            }
            queueData.employees[employeeIndex].updatedAt = getSaudiTimeString();
            queueData.employees[employeeIndex].updatedBy = `employee_${employeeId}`;
        }
        
        saveQueueData(queueData);
        broadcastQueueUpdate();
        
        res.json({ success: true, data: queueData, employee: queueData.employees[employeeIndex] });
    } catch (error) {
        console.error('Error signing in employee:', error);
        res.status(500).json({ error: 'Failed to sign in employee' });
    }
});

// API: Update advisor status
app.post('/api/queue/advisor/update-status', (req, res) => {
    try {
        const { advisorId, status } = req.body;
        
        if (!advisorId || !status) {
            return res.status(400).json({ error: 'advisorId and status are required' });
        }
        
        if (!['available', 'busy', 'out_of_office'].includes(status)) {
            return res.status(400).json({ error: 'status must be "available", "busy", or "out_of_office"' });
        }
        
        const queueData = getQueueData();
        const advisor = queueData.employees.find(e => e.id === String(advisorId) && e.type === 'advisor');
        
        if (!advisor) {
            return res.status(404).json({ error: 'Advisor not found' });
        }
        
        const oldStatus = advisor.status;
        const now = getSaudiTimeString();
        let completedCount = 0;
        
        // Update lastStatusUpdate timestamp
        advisor.lastStatusUpdate = now;
        
        // If changing from busy to available, mark all active customers as completed/done
        if (oldStatus === 'busy' && status === 'available') {
            const activeCustomers = (queueData.customers || []).filter(c => 
                c.employeeId === String(advisorId) && 
                (c.status === 'accepted' || c.status === 'active') && 
                !c.completedAt
            );
            
            completedCount = activeCustomers.length;
            
            activeCustomers.forEach(customer => {
                customer.completedAt = now;
                customer.status = 'served'; // Mark as served/done
                customer.servedAt = now;
                
                // Log customer completion (use customer_served to match admin report expectations)
                logAction({
                    action: 'customer_served',
                    customerId: customer.id,
                    customerName: customer.customerName,
                    customerPhone: customer.customerPhone || 'N/A',
                    advisorId: advisorId,
                    advisorName: advisor.displayName || advisor.name,
                    servedAt: now,
                    completedAt: now
                });
            });
        }
        
        advisor.status = status;
        advisor.updatedAt = now;
        advisor.updatedBy = `advisor_${advisorId}`;
        
        // If advisor became available (from busy or out_of_office), extract from waiting area
        if (status === 'available' && (oldStatus === 'busy' || oldStatus === 'out_of_office')) {
            // Extract oldest customer from waiting area (FIFO)
            extractFromWaitingArea(queueData, String(advisorId));
        }
        
        saveQueueData(queueData);
        
        // Log status change (including out_of_office)
        logAction({
            action: 'status_change',
            advisorId: advisorId,
            advisorName: advisor.displayName || advisor.name,
            oldStatus: oldStatus,
            newStatus: status,
            changedAt: now,
            changedBy: `advisor_${advisorId}`,
            customersCompleted: completedCount
        });
        
        broadcastQueueUpdate();
        
        res.json({ success: true, advisor: advisor });
    } catch (error) {
        console.error('Error updating advisor status:', error);
        res.status(500).json({ error: 'Failed to update advisor status' });
    }
});

// API: Update employee status (admin only)
app.post('/api/queue/update', authenticateBackend, (req, res) => {
    try {
        const { employeeId, status } = req.body;
        
        if (!employeeId || !status) {
            return res.status(400).json({ error: 'employeeId and status are required' });
        }
        
        if (!['available', 'busy', 'out_of_office'].includes(status)) {
            return res.status(400).json({ error: 'status must be "available", "busy", or "out_of_office"' });
        }
        
        const queueData = getQueueData();
        
        // Find employee
        let employeeIndex = queueData.employees.findIndex(e => e.id === String(employeeId));
        
        if (employeeIndex === -1) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        
        const oldStatus = queueData.employees[employeeIndex].status;
        
        // Update employee status
        queueData.employees[employeeIndex].status = status;
        queueData.employees[employeeIndex].updatedAt = new Date().toISOString();
        queueData.employees[employeeIndex].updatedBy = 'admin';
        
        // If changing from busy to available, mark current customer as completed
        if (oldStatus === 'busy' && status === 'available') {
            const activeCustomer = queueData.customers.find(c => 
                c.employeeId === String(employeeId) && !c.completedAt);
            if (activeCustomer) {
                activeCustomer.completedAt = new Date().toISOString();
                activeCustomer.status = 'completed';
            }
        }
        
        saveQueueData(queueData);
        broadcastQueueUpdate();
        
        res.json({ success: true, data: queueData });
    } catch (error) {
        console.error('Error updating queue:', error);
        res.status(500).json({ error: 'Failed to update queue' });
    }
});

// API: Assign customer to employee (promoter function)
app.post('/api/queue/assign-customer', (req, res) => {
    try {
        const { employeeId, customerName, customerPhone, assignedBy } = req.body;
        
        if (!employeeId || !customerName || !customerPhone) {
            return res.status(400).json({ error: 'employeeId, customerName, and customerPhone are required' });
        }
        
        const queueData = getQueueData();
        
        // Find employee
        const employee = queueData.employees.find(e => e.id === String(employeeId));
        if (!employee) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        
        // Create customer record
        const now = getSaudiTimeString();
        const customer = {
            id: `customer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            employeeId: String(employeeId),
            customerName: customerName,
            customerPhone: customerPhone,
            createdAt: now,
            assignedAt: now,
            acceptedAt: now,
            assignedBy: assignedBy || 'promoter',
            createdBy: assignedBy || 'promoter',
            status: 'accepted'
        };
        
        queueData.customers.push(customer);
        
        // Update employee status to busy if not already
        const employeeIndex = queueData.employees.findIndex(e => e.id === String(employeeId));
        if (queueData.employees[employeeIndex].status === 'available') {
            queueData.employees[employeeIndex].status = 'busy';
        }
        queueData.employees[employeeIndex].updatedAt = now;
        queueData.employees[employeeIndex].updatedBy = assignedBy || 'promoter';
        
        saveQueueData(queueData);
        broadcastQueueUpdate();
        
        res.json({ success: true, data: queueData, customer: customer });
    } catch (error) {
        console.error('Error assigning customer:', error);
        res.status(500).json({ error: 'Failed to assign customer' });
    }
});

// API: Add customer to waiting list (for users 11-16)
app.post('/api/queue/add-waiting', (req, res) => {
    try {
        const { advisorId, customerName, customerPhone, addedBy, customerType } = req.body;
        
        if (!customerName) {
            return res.status(400).json({ error: 'customerName is required' });
        }
        
        const queueData = getQueueData();
        
        if (!queueData.waitingList) {
            queueData.waitingList = [];
        }
        
        // Initialize waiting area if not exists
        if (!queueData.waitingArea) {
            queueData.waitingArea = {
                id: 'WAITING_AREA',
                name: 'Waiting Area',
                customers: []
            };
        }
        
        const now = getSaudiTimeString();
        
        // Allow assignment to waiting area if advisorId is 'WAITING_AREA' or empty
        let isWaitingArea = false;
        let assignedAdvisorId = advisorId;
        
        if (!advisorId || advisorId === 'auto' || advisorId === '' || advisorId === 'WAITING_AREA') {
            // Assign to waiting area
            isWaitingArea = true;
            assignedAdvisorId = 'WAITING_AREA';
        } else {
            // Verify advisor exists (S1-S8)
            const advisorIds = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];
            if (!advisorIds.includes(String(assignedAdvisorId))) {
                return res.status(400).json({ error: 'Invalid advisor ID. Must be S1-S8 or WAITING_AREA' });
            }
        }
        
        let isWaitingList = false;
        
        let waitingNumber = 1;
        
        // If assigned to waiting area, add directly there
        if (isWaitingArea) {
            waitingNumber = (queueData.waitingArea.customers || []).length + 1;
            const waitingItem = {
                id: `waiting_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                advisorId: 'WAITING_AREA',
                customerName: customerName,
                customerPhone: customerPhone || '',
                customerType: customerType || 'regular',
                sourceType: customerType === 'phone_call' ? 'PHONE_CALL' : customerType === 'guest_experience' ? 'GUEST_EXPERIENCE' : 'WALK_IN',
                tag: customerType === 'phone_call' ? 'PHONE CALL' : customerType === 'guest_experience' ? 'GUEST EXPERIENCE' : '',
                createdAt: now,
                addedBy: addedBy || 'promoter',
                assignedBy: 'promoter', // Track that this was assigned by promoter
                status: 'waiting',
                waitingNumber: waitingNumber
            };
            
            if (!queueData.waitingArea.customers) {
                queueData.waitingArea.customers = [];
            }
            queueData.waitingArea.customers.push(waitingItem);
            
            // Sort by createdAt to maintain FIFO
            queueData.waitingArea.customers.sort((a, b) => {
                return new Date(a.createdAt) - new Date(b.createdAt);
            });
            
            // Update waiting numbers
            queueData.waitingArea.customers.forEach((c, index) => {
                c.waitingNumber = index + 1;
            });
            
            saveQueueData(queueData);
            
            // Log assignment to waiting area
            logAction({
                action: 'customer_added_to_waiting_area',
                customerId: waitingItem.id,
                customerName: customerName,
                customerPhone: customerPhone || '',
                customerType: customerType || 'regular',
                sourceType: waitingItem.sourceType,
                tag: waitingItem.tag,
                addedBy: addedBy || 'promoter',
                assignedBy: 'promoter',
                waitingAreaId: 'WAITING_AREA',
                waitingNumber: waitingNumber
            });
            
            broadcastQueueUpdate();
            
            res.json({ 
                success: true, 
                data: queueData, 
                waitingItem: waitingItem,
                waitingAreaId: 'WAITING_AREA',
                message: 'Customer added to waiting area'
            });
            return;
        }
        
        if (isWaitingList) {
            // Add to waiting area
            waitingNumber = (queueData.waitingArea.customers || []).length + 1;
            const waitingItem = {
                id: `waiting_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                advisorId: 'WAITING_AREA',
                customerName: customerName,
                customerPhone: customerPhone || 'N/A',
                customerType: customerType || 'regular',
                createdAt: now,
                addedBy: addedBy || 'promoter',
                status: 'waiting',
                waitingNumber: waitingNumber
            };
            
            if (!queueData.waitingArea.customers) {
                queueData.waitingArea.customers = [];
            }
            queueData.waitingArea.customers.push(waitingItem);
            
            saveQueueData(queueData);
            broadcastQueueUpdate();
            
            res.json({ 
                success: true, 
                data: queueData, 
                waitingItem: waitingItem,
                waitingAreaId: 'WAITING_AREA',
                message: 'Customer added to waiting area (all advisors have customers)'
            });
            return;
        }
        
        // Direct assignment to advisor - add to advisor's waiting list (only ONE customer per advisor)
        // Check if advisor exists in system (allow assignment even if not logged in)
        let targetAdvisor = queueData.employees.find(e => e.id === String(assignedAdvisorId) && e.type === 'advisor');
        const isAdvisorAddingToSelf = addedBy && addedBy.startsWith('advisor_'); // Check if advisor is adding to themselves
        
        // If advisor doesn't exist in system, create them (for S1-S8)
        if (!targetAdvisor && ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'].includes(String(assignedAdvisorId))) {
            const defaultName = getDefaultAdvisorName(String(assignedAdvisorId));
            targetAdvisor = {
                id: String(assignedAdvisorId),
                name: defaultName,
                status: 'out_of_office',
                updatedAt: new Date().toISOString(),
                updatedBy: 'system',
                type: 'advisor',
                dailyCustomersCount: 0
            };
            queueData.employees.push(targetAdvisor);
        }
        
        // If advisor still doesn't exist, send to waiting area
        if (!targetAdvisor) {
            waitingNumber = (queueData.waitingArea.customers || []).length + 1;
            const waitingItem = {
                id: `waiting_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                advisorId: 'WAITING_AREA',
                customerName: customerName,
                customerPhone: customerPhone || 'N/A',
                customerType: customerType || 'regular',
                createdAt: now,
                addedBy: addedBy || 'promoter',
                status: 'waiting',
                waitingNumber: waitingNumber
            };
            
            if (!queueData.waitingArea.customers) {
                queueData.waitingArea.customers = [];
            }
            queueData.waitingArea.customers.push(waitingItem);
            
            saveQueueData(queueData);
            broadcastQueueUpdate();
            
            res.json({ 
                success: true, 
                data: queueData, 
                waitingItem: waitingItem,
                waitingAreaId: 'WAITING_AREA',
                message: `Customer added to waiting area (${assignedAdvisorId} not found)`
            });
            return;
        }
        
        // For regular customers from promoter, check if advisor already has a customer
        // For advisor adding to self, ALWAYS assign to advisor's queue (even if they have a customer)
        if (!isAdvisorAddingToSelf && advisorHasCustomer(queueData, String(assignedAdvisorId))) {
            // Advisor already has a customer, send to waiting area instead
            waitingNumber = (queueData.waitingArea.customers || []).length + 1;
            const waitingItem = {
                id: `waiting_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                advisorId: 'WAITING_AREA',
                customerName: customerName,
                customerPhone: customerPhone || 'N/A',
                customerType: customerType || 'regular',
                createdAt: now,
                addedBy: addedBy || 'promoter',
                status: 'waiting',
                waitingNumber: waitingNumber
            };
            
            if (!queueData.waitingArea.customers) {
                queueData.waitingArea.customers = [];
            }
            queueData.waitingArea.customers.push(waitingItem);
            
            saveQueueData(queueData);
            broadcastQueueUpdate();
            
            res.json({ 
                success: true, 
                data: queueData, 
                waitingItem: waitingItem,
                waitingAreaId: 'WAITING_AREA',
                message: `Customer added to waiting area (${assignedAdvisorId} already has a customer)`
            });
            return;
        }
        
        // Assign directly to advisor's queue
        // For advisor adding to self: always assign to advisor's queue (status = waiting, goes to their personal queue)
        // For regular from promoter: assign if advisor is available (status = assigned)
        const assignedItem = {
            id: `waiting_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            advisorId: String(assignedAdvisorId),
            customerName: customerName,
            customerPhone: customerPhone || 'N/A',
            customerType: customerType || 'regular',
            sourceType: customerType === 'phone_call' ? 'PHONE_CALL' : customerType === 'guest_experience' ? 'GUEST_EXPERIENCE' : 'WALK_IN',
            tag: customerType === 'phone_call' ? 'PHONE CALL' : customerType === 'guest_experience' ? 'GUEST EXPERIENCE' : '',
            createdAt: now,
            assignedAt: isAdvisorAddingToSelf ? null : now, // Don't set assignedAt if advisor is adding to self (goes to waiting)
            addedBy: addedBy || 'promoter',
            status: isAdvisorAddingToSelf ? 'waiting' : 'assigned', // Self-added go to personal queue as waiting
            autoAssigned: false // No more auto-assignment
        };
        
        // Calculate waiting number for this advisor
        const advisorWaitingList = (queueData.waitingList || []).filter(w => 
            w.advisorId === String(assignedAdvisorId) && w.status === 'waiting'
        );
        assignedItem.waitingNumber = advisorWaitingList.length + 1;
        
        // Add to advisor's waiting list (but status is ASSIGNED, ready to accept)
        if (!queueData.waitingList) {
            queueData.waitingList = [];
        }
        queueData.waitingList.push(assignedItem);
        
        // Don't increment count here - count only when customer is ACCEPTED
        // This prevents double-counting (assignment + acceptance)
        
        const waitingItem = assignedItem;
        
        saveQueueData(queueData);
        
        // Get advisor name for logging (targetAdvisor already found above)
        const advisorName = targetAdvisor ? (targetAdvisor.displayName || targetAdvisor.name) : assignedAdvisorId;
        
        // Log customer addition to waiting list
        logAction({
            action: 'customer_added_to_waiting',
            customerId: waitingItem.id,
            customerName: customerName,
            customerPhone: customerPhone || 'N/A',
            customerType: customerType || 'regular',
            sourceType: assignedItem.sourceType,
            tag: assignedItem.tag,
            advisorId: String(assignedAdvisorId),
            advisorName: advisorName,
            waitingNumber: assignedItem.waitingNumber || waitingNumber,
            addedBy: addedBy || 'promoter',
            autoAssigned: false
        });
        
        broadcastQueueUpdate();
        
        res.json({ 
            success: true, 
            data: queueData, 
            waitingItem: waitingItem,
            message: `Customer assigned to ${assignedAdvisorId}`
        });
    } catch (error) {
        console.error('Error adding to waiting list:', error);
        res.status(500).json({ error: 'Failed to add to waiting list' });
    }
});

// API: Add guest experience (not to waiting list)
app.post('/api/queue/add-guest-experience', (req, res) => {
    try {
        const { customerName, customerPhone, addedBy } = req.body;
        
        if (!customerName) {
            return res.status(400).json({ error: 'customerName is required' });
        }
        
        const queueData = getQueueData();
        
        // Initialize guest experience tracking
        if (!queueData.guestExperience) {
            queueData.guestExperience = {
                total: 0,
                today: 0,
                records: []
            };
        }
        
        const now = getSaudiTimeString();
        const today = getSaudiDateString();
        
        // Check if it's a new day, reset today's count
        if (queueData.guestExperience.lastDate !== today) {
            queueData.guestExperience.today = 0;
            queueData.guestExperience.lastDate = today;
        }
        
        const guestRecord = {
            id: `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            customerName: customerName,
            customerPhone: customerPhone || 'N/A',
            addedBy: addedBy || 'promoter',
            createdAt: now,
            date: today
        };
        
        queueData.guestExperience.records.push(guestRecord);
        queueData.guestExperience.total++;
        queueData.guestExperience.today++;
        
        saveQueueData(queueData);
        
        // Log guest experience
        logAction({
            action: 'guest_experience_added',
            customerId: guestRecord.id,
            customerName: customerName,
            customerPhone: customerPhone || 'N/A',
            addedBy: addedBy || 'promoter',
            totalToday: queueData.guestExperience.today
        });
        
        broadcastQueueUpdate();
        
        res.json({ 
            success: true, 
            data: queueData,
            guestRecord: guestRecord,
            totalToday: queueData.guestExperience.today,
            message: 'Guest experience added successfully'
        });
    } catch (error) {
        console.error('Error adding guest experience:', error);
        res.status(500).json({ error: 'Failed to add guest experience' });
    }
});

// API: Reassign customer to different advisor
app.post('/api/queue/reassign-customer', (req, res) => {
    try {
        const { customerId, newAdvisorId, reassignedBy } = req.body;
        
        if (!customerId || !newAdvisorId) {
            return res.status(400).json({ error: 'customerId and newAdvisorId are required' });
        }
        
        const queueData = getQueueData();
        
        // Find customer in waiting list
        const customerIndex = queueData.waitingList.findIndex(c => c.id === customerId);
        
        if (customerIndex === -1) {
            return res.status(404).json({ error: 'Customer not found in waiting list' });
        }
        
        const customer = queueData.waitingList[customerIndex];
        const oldAdvisorId = customer.advisorId;
        
        // Verify new advisor exists
        const advisorIds = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];
        if (!advisorIds.includes(String(newAdvisorId))) {
            return res.status(400).json({ error: 'Invalid advisor ID' });
        }
        
        // Remove from old advisor's waiting list
        queueData.waitingList.splice(customerIndex, 1);
        
        // Recalculate waiting numbers for old advisor
        recalculateWaitingNumbers(queueData);
        
        // Calculate new waiting number for new advisor
        const newAdvisorWaitingList = queueData.waitingList.filter(
            w => w.advisorId === String(newAdvisorId) && w.status === 'waiting'
        );
        const newWaitingNumber = newAdvisorWaitingList.length + 1;
        
        // Add to new advisor's waiting list
        customer.advisorId = String(newAdvisorId);
        customer.waitingNumber = newWaitingNumber;
        customer.reassignedAt = new Date().toISOString();
        customer.reassignedFrom = oldAdvisorId;
        customer.reassignedBy = reassignedBy || 'promoter';
        customer.alertSent = false; // Reset alert flag
        customer.reassignmentCount = (customer.reassignmentCount || 0) + 1;
        
        queueData.waitingList.push(customer);
        
        // Recalculate waiting numbers for new advisor
        recalculateWaitingNumbers(queueData);
        
        // Get advisor names for logging
        const oldAdvisor = queueData.employees.find(e => e.id === oldAdvisorId && e.type === 'advisor');
        const newAdvisor = queueData.employees.find(e => e.id === String(newAdvisorId) && e.type === 'advisor');
        
        saveQueueData(queueData);
        
        // Log reassignment
        logAction({
            action: 'customer_reassigned',
            customerId: customer.id,
            customerName: customer.customerName,
            oldAdvisorId: oldAdvisorId,
            oldAdvisorName: oldAdvisor ? (oldAdvisor.displayName || oldAdvisor.name) : oldAdvisorId,
            newAdvisorId: String(newAdvisorId),
            newAdvisorName: newAdvisor ? (newAdvisor.displayName || newAdvisor.name) : String(newAdvisorId),
            reassignedBy: reassignedBy || 'promoter',
            reassignmentCount: customer.reassignmentCount
        });
        
        broadcastQueueUpdate();
        
        res.json({ success: true, customer: customer, message: 'Customer reassigned successfully' });
    } catch (error) {
        console.error('Error reassigning customer:', error);
        res.status(500).json({ error: 'Failed to reassign customer' });
    }
});

// API: Get escalated customers (waiting >5 minutes)
app.get('/api/queue/escalated-customers', authenticateBackend, (req, res) => {
    try {
        const queueData = getQueueData();
        const now = new Date();
        const FIVE_MINUTES = 5 * 60 * 1000;
        const escalatedCustomers = [];
        
        // Check waiting area customers
        const waitingAreaCustomers = (queueData.waitingArea && queueData.waitingArea.customers) || [];
        waitingAreaCustomers.forEach((customer) => {
            if (customer.status === 'waiting' && customer.createdAt) {
                const waitTime = now - new Date(customer.createdAt);
                
                if (waitTime > FIVE_MINUTES && !customer.handledByAdmin) {
                    escalatedCustomers.push({
                        customerId: customer.id,
                        customerName: customer.customerName,
                        customerPhone: customer.customerPhone || 'N/A',
                        waitTimeMinutes: Math.round(waitTime / 60000),
                        createdAt: customer.createdAt,
                        escalatedAt: customer.escalatedAt || customer.createdAt,
                        waitExceeded5Min: customer.waitExceeded5Min || true,
                        sourceType: customer.sourceType || customer.customerType || 'WALK_IN',
                        tag: customer.tag || ''
                    });
                }
            }
        });
        
        // Also check waiting list (assigned to advisors)
        const waitingList = queueData.waitingList || [];
        waitingList.forEach((customer) => {
            if (customer.status === 'waiting' && customer.createdAt) {
                const waitTime = now - new Date(customer.createdAt);
                
                if (waitTime > FIVE_MINUTES && !customer.handledByAdmin) {
                    const advisor = queueData.employees.find(e => e.id === customer.advisorId && e.type === 'advisor');
                    escalatedCustomers.push({
                        customerId: customer.id,
                        customerName: customer.customerName,
                        customerPhone: customer.customerPhone || 'N/A',
                        advisorId: customer.advisorId,
                        advisorName: advisor ? (advisor.displayName || advisor.name) : customer.advisorId,
                        waitTimeMinutes: Math.round(waitTime / 60000),
                        createdAt: customer.createdAt,
                        escalatedAt: customer.escalatedAt || customer.createdAt,
                        waitExceeded5Min: customer.waitExceeded5Min || true,
                        sourceType: customer.sourceType || customer.customerType || 'WALK_IN',
                        tag: customer.tag || ''
                    });
                }
            }
        });
        
        res.json({ escalatedCustomers: escalatedCustomers });
    } catch (error) {
        console.error('Error getting escalated customers:', error);
        res.status(500).json({ error: 'Failed to get escalated customers' });
    }
});

// API: Admin handle escalated customer
app.post('/api/queue/admin-handle-customer', authenticateBackend, (req, res) => {
    try {
        const { customerId } = req.body;
        
        if (!customerId) {
            return res.status(400).json({ error: 'customerId is required' });
        }
        
        const queueData = getQueueData();
        const now = getSaudiTimeString();
        
        // Find customer in waiting area
        let customer = null;
        let customerLocation = null;
        
        const waitingAreaCustomers = (queueData.waitingArea && queueData.waitingArea.customers) || [];
        const waitingList = queueData.waitingList || [];
        
        // Check waiting area first
        const areaIndex = waitingAreaCustomers.findIndex(c => c.id === customerId);
        if (areaIndex >= 0) {
            customer = waitingAreaCustomers[areaIndex];
            customerLocation = 'waitingArea';
        }
        
        // Check waiting list
        if (!customer) {
            const listIndex = waitingList.findIndex(c => c.id === customerId);
            if (listIndex >= 0) {
                customer = waitingList[listIndex];
                customerLocation = 'waitingList';
            }
        }
        
        if (!customer) {
            return res.status(404).json({ error: 'Customer not found in waiting area or waiting list' });
        }
        
        // Mark as admin handled
        customer.status = 'ADMIN_HANDLED';
        customer.handledByAdmin = true;
        customer.adminHandledAt = now;
        customer.adminHandledBy = 'admin';
        customer.waitExceeded5Min = true;
        
        // Remove from waiting area or waiting list
        if (customerLocation === 'waitingArea') {
            queueData.waitingArea.customers.splice(areaIndex, 1);
        } else if (customerLocation === 'waitingList') {
            waitingList.splice(listIndex, 1);
            recalculateWaitingNumbers(queueData);
        }
        
        // Add to customers array with ADMIN_HANDLED status
        if (!queueData.customers) {
            queueData.customers = [];
        }
        queueData.customers.push(customer);
        
        // Log the admin handling
        logAction({
            action: 'customer_admin_handled',
            customerId: customer.id,
            customerName: customer.customerName,
            customerPhone: customer.customerPhone || 'N/A',
            advisorId: customer.advisorId || 'WAITING_AREA',
            advisorName: customer.advisorName || 'Waiting Area',
            waitTimeMinutes: customer.waitTimeMinutes || 0,
            adminHandledAt: now,
            adminHandledBy: 'admin',
            handledByAdmin: true,
            waitExceeded5Min: true
        });
        
        saveQueueData(queueData);
        broadcastQueueUpdate();
        
        res.json({ 
            success: true, 
            message: 'Customer handled by admin successfully',
            customer: customer
        });
    } catch (error) {
        console.error('Error handling customer by admin:', error);
        res.status(500).json({ error: 'Failed to handle customer by admin' });
    }
});

// API: Get admin alerts (customers removed due to timeout) - Legacy endpoint
app.get('/api/queue/admin-alerts', authenticateBackend, (req, res) => {
    try {
        const queueLog = getQueueLog();
        const now = new Date();
        const today = getSaudiDateString();
        
        // Get all customer_removed_timeout and customer_admin_handled actions from today
        const timeoutAlerts = queueLog.filter(log => 
            (log.action === 'customer_removed_timeout' || log.action === 'customer_admin_handled') && 
            log.date === today
        ).map(log => ({
            customerId: log.customerId,
            customerName: log.customerName,
            customerPhone: log.customerPhone || 'N/A',
            advisorId: log.advisorId,
            advisorName: log.advisorName || log.advisorId,
            waitTimeMinutes: log.waitTimeMinutes,
            removedAt: log.removedAt || log.adminHandledAt || log.timestamp,
            adminHandled: log.handledByAdmin || log.adminHandled || false,
            message: `Customer "${log.customerName}" (${log.customerPhone || 'N/A'}) has been waiting for more than 5 minutes${log.handledByAdmin ? ' - ADMIN HANDLED' : ''}`
        }));
        
        res.json({ alerts: timeoutAlerts });
    } catch (error) {
        console.error('Error getting admin alerts:', error);
        res.status(500).json({ error: 'Failed to get admin alerts' });
    }
});

// API: Get active alerts for promoters
app.get('/api/queue/alerts', (req, res) => {
    try {
        const queueData = getQueueData();
        const waitingList = queueData.waitingList || [];
        const now = new Date();
        const FIVE_MINUTES = 5 * 60 * 1000;
        const alerts = [];
        
        waitingList.forEach(customer => {
            if (customer.status === 'waiting' && customer.createdAt) {
                const waitTime = now - new Date(customer.createdAt);
                
                if (waitTime > FIVE_MINUTES) {
                    const advisor = queueData.employees.find(e => e.id === customer.advisorId && e.type === 'advisor');
                    alerts.push({
                        customerId: customer.id,
                        customerName: customer.customerName,
                        customerPhone: customer.customerPhone,
                        advisorId: customer.advisorId,
                        advisorName: advisor?.name || customer.advisorId,
                        waitTimeMinutes: Math.round(waitTime / 60000),
                        createdAt: customer.createdAt,
                        alertSent: customer.alertSent || false
                    });
                }
            }
        });
        
        res.json({ alerts: alerts });
    } catch (error) {
        console.error('Error getting alerts:', error);
        res.status(500).json({ error: 'Failed to get alerts' });
    }
});

// API: Assign advisor to position
app.post('/api/queue/advisor/assign-position', (req, res) => {
    try {
        const { advisorId, advisorName, position, password } = req.body;
        
        if (!advisorId || !position || !password) {
            return res.status(400).json({ error: 'advisorId, position, and password are required' });
        }

        // Verify password - this endpoint is deprecated, use signin instead
        // Keeping for backward compatibility
        const advisorInfo = getAdvisorInfoFromName(advisorName);
        if (!advisorInfo || advisorInfo.id !== advisorId || advisorInfo.password !== password) {
            return res.status(401).json({ error: 'Invalid password' });
        }

        if (!['S1', 'S2', 'S3', 'S4'].includes(position)) {
            return res.status(400).json({ error: 'Position must be S1, S2, S3, or S4' });
        }

        const queueData = getQueueData();
        
        // Check if position is already taken by another advisor
        const positionAdvisor = queueData.employees.find(e => e.id === position && e.type === 'advisor');
        // Only reject if position is taken by a DIFFERENT advisor (allow same advisor to reassign)
        if (positionAdvisor && positionAdvisor.assignedAdvisorId && positionAdvisor.assignedAdvisorId !== advisorId) {
            return res.status(400).json({ error: `Position ${position} is already taken by another advisor` });
        }

        // Find or create advisor at position
        let advisor = queueData.employees.find(e => e.id === position && e.type === 'advisor');
        
        if (!advisor) {
            // Create new advisor entry for this position
            advisor = {
                id: position,
                name: `Sales Advisor ${position}`,
                status: 'available',
                updatedAt: new Date().toISOString(),
                updatedBy: 'system',
                type: 'advisor',
                dailyCustomersCount: 0
            };
            queueData.employees.push(advisor);
        }

        // Update advisor with actual advisor info
        advisor.assignedAdvisorId = advisorId;
        advisor.displayName = advisorName;
        advisor.name = advisorName; // Update name for display
        advisor.assignedAt = new Date().toISOString();
        advisor.updatedAt = new Date().toISOString();
        advisor.updatedBy = `advisor_${advisorId}`;

        saveQueueData(queueData);

        // Log position assignment
        logAction({
            action: 'advisor_position_assigned',
            advisorId: advisorId,
            advisorName: advisorName,
            position: position,
            assignedAt: advisor.assignedAt
        });

        broadcastQueueUpdate();

        res.json({ 
            success: true, 
            advisor: advisor,
            message: `${advisorName} assigned to position ${position}`
        });
    } catch (error) {
        console.error('Error assigning advisor position:', error);
        res.status(500).json({ error: 'Failed to assign advisor position' });
    }
});

// API: Sales Advisor logout - clear position assignment
app.post('/api/queue/advisor/logout', (req, res) => {
    try {
        const { position, advisorId } = req.body;
        
        if (!position) {
            return res.status(400).json({ error: 'position is required' });
        }

        const queueData = getQueueData();
        const advisor = queueData.employees.find(e => e.id === position && e.type === 'advisor');
        
        if (!advisor) {
            return res.status(404).json({ error: 'Position not found' });
        }

        // Only clear if the logged out advisor matches the assigned advisor
        if (advisor.assignedAdvisorId && advisorId && advisor.assignedAdvisorId === advisorId) {
            const advisorName = advisor.displayName || advisor.name;
            
            // Clear position assignment but keep the position entry
            advisor.assignedAdvisorId = null;
            advisor.displayName = null;
            advisor.name = `Sales Advisor ${position}`;
            advisor.status = 'out_of_office';
            advisor.updatedAt = new Date().toISOString();
            advisor.updatedBy = 'system';
            
            saveQueueData(queueData);

            // Log logout
            logAction({
                action: 'advisor_logged_out',
                advisorId: advisorId,
                advisorName: advisorName,
                position: position,
                loggedOutAt: new Date().toISOString()
            });

            broadcastQueueUpdate();

            res.json({ 
                success: true, 
                message: `${advisorName} logged out from position ${position}`
            });
        } else {
            // Position already cleared or different advisor
            res.json({ 
                success: true, 
                message: 'Position already available'
            });
        }
    } catch (error) {
        console.error('Error logging out advisor:', error);
        res.status(500).json({ error: 'Failed to logout advisor' });
    }
});

// API: Sales Advisor sign in
app.post('/api/queue/advisor/signin', (req, res) => {
    try {
        const { advisorId, advisorName, password } = req.body;
        
        let advisorInfo;
        let finalAdvisorId;
        let finalAdvisorName;
        
        // If password is empty, allow signin if advisorId and advisorName match (for already logged in users)
        if (!password || password === '') {
            if (!advisorId || !advisorName) {
                return res.status(400).json({ error: 'advisorId and advisorName are required when password is not provided' });
            }
            // Allow signin without password check for already authenticated users
            advisorInfo = getAdvisorInfoFromName(advisorName);
            if (!advisorInfo || advisorInfo.id !== advisorId) {
                return res.status(401).json({ error: 'Invalid advisor information' });
            }
            finalAdvisorId = advisorInfo.id;
            finalAdvisorName = advisorInfo.name;
        } else {
            // Full authentication with password
            if (!advisorName || !password) {
                return res.status(400).json({ error: 'advisorName and password are required' });
            }
            
            // Check name and password mapping
            advisorInfo = getAdvisorInfoFromName(advisorName);
            if (!advisorInfo || advisorInfo.password !== password) {
                return res.status(401).json({ error: 'Invalid name or password' });
            }
            finalAdvisorId = advisorInfo.id;
            finalAdvisorName = advisorInfo.name;
        }
        
        const queueData = getQueueData();
        let advisor = queueData.employees.find(e => e.id === String(finalAdvisorId) && e.type === 'advisor');
        
        if (!advisor) {
            // Create advisor if doesn't exist
            advisor = {
                id: finalAdvisorId,
                name: finalAdvisorName,
                status: 'available',
                updatedAt: new Date().toISOString(),
                updatedBy: 'system',
                type: 'advisor',
                dailyCustomersCount: 0
            };
            queueData.employees.push(advisor);
        }
        
        // Update advisor with login info
        advisor.assignedAdvisorId = finalAdvisorId;
        advisor.displayName = finalAdvisorName;
        advisor.name = finalAdvisorName;
        advisor.lastStatusUpdate = getSaudiTimeString(); // Track last status update for auto-logout
        advisor.status = 'available'; // Set to available on login
        
        // Initialize dailyCustomersCount if missing
        if (advisor.dailyCustomersCount === undefined) {
            advisor.dailyCustomersCount = 0;
        }
        
        saveQueueData(queueData);
        broadcastQueueUpdate();
        
        // Log sign in
        logAction({
            action: 'advisor_signed_in',
            advisorId: finalAdvisorId,
            advisorName: finalAdvisorName,
            timestamp: new Date().toISOString()
        });
        
        res.json({ 
            success: true, 
            advisor: {
                ...advisor,
                displayName: finalAdvisorName,
                name: finalAdvisorName
            }
        });
    } catch (error) {
        console.error('Error signing in advisor:', error);
        res.status(500).json({ error: 'Failed to sign in advisor' });
    }
});

// API: Get advisor dashboard data
app.get('/api/queue/advisor/:advisorId/dashboard', (req, res) => {
    try {
        const advisorId = req.params.advisorId;
        const queueData = getQueueData();
        
        const advisor = queueData.employees.find(e => e.id === String(advisorId) && e.type === 'advisor');
        if (!advisor) {
            return res.status(404).json({ error: 'Advisor not found' });
        }
        
        // Get waiting list for this advisor (both waiting and assigned status - max 1 customer)
        const waitingList = (queueData.waitingList || []).filter(w => 
            w.advisorId === String(advisorId) && (w.status === 'waiting' || w.status === 'assigned')
        );
        
        // Get active customers (status = 'active' or 'accepted', not completed)
        const activeCustomers = (queueData.customers || []).filter(c => 
            c.employeeId === String(advisorId) && 
            (c.status === 'active' || c.status === 'accepted') &&
            !c.completedAt
        );
        
        // Get served customers (status = 'served', completed)
        const servedCustomers = (queueData.customers || []).filter(c => 
            c.employeeId === String(advisorId) && 
            c.status === 'served' && 
            c.completedAt
        ).sort((a, b) => new Date(b.servedAt || b.completedAt) - new Date(a.servedAt || a.completedAt)); // Most recent first
        
        // Get waiting area customers (for advisor to see)
        const waitingArea = queueData.waitingArea || { customers: [] };
        const waitingAreaCustomers = waitingArea.customers || [];
        
        res.json({
            success: true,
            advisor: advisor,
            waitingList: waitingList,
            activeCustomers: activeCustomers,
            servedCustomers: servedCustomers, // Include served customers
            waitingArea: waitingAreaCustomers, // Include waiting area for advisor to see
            customers: queueData.customers || [], // Include all customers for counting
            todayAcceptedCount: advisor.dailyCustomersCount || 0, // Use advisor's daily count
            totalQueue: waitingList.length + activeCustomers.length
        });
    } catch (error) {
        console.error('Error getting advisor dashboard:', error);
        res.status(500).json({ error: 'Failed to get advisor dashboard' });
    }
});

// API: Accept or miss customer (sales advisor)
app.post('/api/queue/advisor/customer-action', (req, res) => {
    try {
        const { advisorId, customerId, action, reason } = req.body;
        
        if (!advisorId || !customerId || !action) {
            return res.status(400).json({ error: 'advisorId, customerId, and action are required' });
        }
        
        if (!['accepted', 'missed', 'transfer', 'served', 'rejected'].includes(action)) {
            return res.status(400).json({ error: 'action must be "accepted", "missed", "transfer", "served", or "rejected"' });
        }
        
        if ((action === 'missed' || action === 'rejected') && !reason) {
            return res.status(400).json({ error: 'reason is required when action is "missed" or "rejected"' });
        }
        
        if (action === 'transfer') {
            const { transferToAdvisorId } = req.body;
            if (!transferToAdvisorId) {
                return res.status(400).json({ error: 'transferToAdvisorId is required when action is "transfer"' });
            }
        }
        
        const queueData = getQueueData();
        
        // Find customer in waiting list, active customers, or waiting area
        let customer = null;
        let customerIndex = -1;
        let customerLocation = null; // 'waitingList', 'customers', 'waitingArea'
        
        // Check waiting list first
        if (queueData.waitingList) {
            customerIndex = queueData.waitingList.findIndex(c => c.id === customerId);
            if (customerIndex >= 0) {
                customer = queueData.waitingList[customerIndex];
                customerLocation = 'waitingList';
            }
        }
        
        // If not in waiting list, check active customers (accepted or active status)
        if (!customer && queueData.customers) {
            customerIndex = queueData.customers.findIndex(c => 
                c.id === customerId && c.employeeId === String(advisorId) && (c.status === 'accepted' || c.status === 'active') && !c.completedAt
            );
            if (customerIndex >= 0) {
                customer = queueData.customers[customerIndex];
                customerLocation = 'customers';
            }
        }
        
        // Also check waiting area
        if (!customer && queueData.waitingArea && queueData.waitingArea.customers) {
            customerIndex = queueData.waitingArea.customers.findIndex(c => c.id === customerId);
            if (customerIndex >= 0) {
                customer = queueData.waitingArea.customers[customerIndex];
                customerLocation = 'waitingArea';
            }
        }
        
        if (!customer) {
            return res.status(404).json({ error: 'Customer not found in queue' });
        }
        
        const now = getSaudiTimeString();
        const today = getSaudiDateString();
        
        if (action === 'accepted') {
            // Check if advisor is trying to accept a customer from waiting list
            if (queueData.waitingList && customerIndex >= 0) {
                // Verify this is the oldest customer for this advisor (check both waiting and assigned status)
                const advisorWaitingList = queueData.waitingList.filter(w => 
                    w.advisorId === String(advisorId) && (w.status === 'waiting' || w.status === 'assigned')
                );
                
                if (advisorWaitingList.length > 0) {
                    // Sort by creation time to find oldest
                    advisorWaitingList.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
                    const oldestCustomer = advisorWaitingList[0];
                    
                    // Only allow accepting the oldest customer
                    if (customer.id !== oldestCustomer.id) {
                        return res.status(400).json({ 
                            error: 'You can only accept the oldest customer in your waiting list. Please accept the customer who has been waiting the longest.',
                            oldestCustomerId: oldestCustomer.id,
                            oldestCustomerName: oldestCustomer.customerName
                        });
                    }
                }
                
                // Remove from waiting list
                queueData.waitingList.splice(customerIndex, 1);
                
                // Recalculate waiting numbers for this advisor
                recalculateWaitingNumbers(queueData);
                
                // Calculate wait time
                const waitTime = now - new Date(customer.createdAt);
                const waitTimeMinutes = Math.round(waitTime / 60000);
                
                // Add to customers (status = ACTIVE)
                customer.status = 'active';
                customer.acceptedAt = now;
                customer.assignedAt = customer.assignedAt || now;
                customer.employeeId = String(advisorId);
                customer.waitTimeMinutes = waitTimeMinutes; // Store wait time
                if (!queueData.customers) queueData.customers = [];
                queueData.customers.push(customer);
                
            } else {
                // Update existing customer
                customer.status = 'active';
                customer.acceptedAt = now;
            }
            
            // Update advisor status and active customer
            const advisor = queueData.employees.find(e => e.id === String(advisorId) && e.type === 'advisor');
            if (advisor) {
                advisor.status = 'busy';
                advisor.activeCustomerId = customer.id; // Track active customer
                advisor.updatedAt = now;
                
                // Increment daily count when customer is ACCEPTED (not just assigned)
                const today = getSaudiDateString();
                if (!advisor.lastResetDate || advisor.lastResetDate !== today) {
                    advisor.dailyCustomersCount = 0;
                    advisor.lastResetDate = today;
                }
                advisor.dailyCustomersCount = (advisor.dailyCustomersCount || 0) + 1;
                
                // Log customer acceptance
                logAction({
                    action: 'customer_accepted',
                    customerId: customer.id,
                    customerName: customer.customerName,
                    advisorId: advisorId,
                    advisorName: advisor.displayName || advisor.name,
                    waitingNumber: customer.waitingNumber || null,
                    acceptedBy: `advisor_${advisorId}`
                });
            }
            
            saveQueueData(queueData);
            broadcastQueueUpdate();
        } else if (action === 'missed') {
            // Preserve original createdAt timestamp (don't change it)
            const originalCreatedAt = customer.createdAt || now;
            
            // Remove customer from current location
            if (customerLocation === 'waitingList' && queueData.waitingList) {
                queueData.waitingList.splice(customerIndex, 1);
                recalculateWaitingNumbers(queueData);
            } else if (customerLocation === 'customers' && queueData.customers) {
                queueData.customers.splice(customerIndex, 1);
            } else if (customerLocation === 'waitingArea' && queueData.waitingArea && queueData.waitingArea.customers) {
                queueData.waitingArea.customers.splice(customerIndex, 1);
            }
            
            // Update advisor's activeCustomerId if this was their active customer
            const advisor = queueData.employees.find(e => e.id === String(advisorId) && e.type === 'advisor');
            if (advisor && advisor.activeCustomerId === customerId) {
                advisor.activeCustomerId = null;
                advisor.updatedAt = now;
            }
            
            // Reset customer fields and move back to waiting area
            customer.status = 'waiting';
            customer.assignedAdvisorId = null;
            customer.assignedAt = null;
            customer.advisorId = 'WAITING_AREA';
            customer.createdAt = originalCreatedAt; // Preserve original timestamp
            customer.missedAt = now;
            customer.missedReason = reason;
            customer.acceptedAt = null;
            customer.employeeId = null;
            
            // Ensure waiting area exists
            if (!queueData.waitingArea) {
                queueData.waitingArea = {
                    id: 'WAITING_AREA',
                    name: 'Waiting Area',
                    customers: []
                };
            }
            if (!queueData.waitingArea.customers) {
                queueData.waitingArea.customers = [];
            }
            
            // Add to waiting area
            queueData.waitingArea.customers.push(customer);
            
            // Sort waiting area by createdAt (oldest first) to maintain proper FIFO order
            queueData.waitingArea.customers.sort((a, b) => {
                const dateA = new Date(a.createdAt || 0);
                const dateB = new Date(b.createdAt || 0);
                return dateA - dateB;
            });
            
            // Update waiting numbers for waiting area
            queueData.waitingArea.customers.forEach((c, index) => {
                c.waitingNumber = index + 1;
            });
            
            // Log the missed action
            logAction({
                action: 'customer_missed_returned_to_waiting',
                customerId: customer.id,
                customerName: customer.customerName,
                advisorId: advisorId,
                advisorName: advisor ? (advisor.displayName || advisor.name) : advisorId,
                reason: reason,
                originalCreatedAt: originalCreatedAt,
                returnedToWaitingArea: true
            });
        } else if (action === 'served') {
            // Mark as served (already counted when accepted, so don't count again)
            customer.status = 'served';
            customer.servedAt = now;
            customer.completedAt = now;
            
            // Update advisor status
            const advisor = queueData.employees.find(e => e.id === String(advisorId) && e.type === 'advisor');
            if (advisor) {
                advisor.updatedAt = now;
                
                // Check if advisor has more active customers, otherwise set to available
                const hasMoreActive = queueData.customers.some(c => 
                    c.employeeId === String(advisorId) && (c.status === 'active' || c.status === 'accepted') && !c.completedAt
                );
                if (!hasMoreActive) {
                    advisor.status = 'available';
                    advisor.activeCustomerId = null;
                    // Do NOT automatically extract from waiting area - advisor must press "Next"
                }
            }
        } else if (action === 'rejected') {
            // Mark as rejected
            customer.status = 'rejected';
            customer.rejectedAt = now;
            customer.rejectedReason = reason;
            customer.completedAt = now;
            
            // Remove from waiting list if it's there
            if (queueData.waitingList && customerIndex >= 0) {
                queueData.waitingList.splice(customerIndex, 1);
                // Recalculate waiting numbers for this advisor
                recalculateWaitingNumbers(queueData);
            }
            
            // Check if advisor has more active customers, otherwise set to available
            const advisor = queueData.employees.find(e => e.id === String(advisorId) && e.type === 'advisor');
            if (advisor) {
                const hasMoreActive = queueData.customers.some(c => 
                    c.employeeId === String(advisorId) && (c.status === 'active' || c.status === 'accepted') && !c.completedAt
                );
                if (!hasMoreActive) {
                    advisor.status = 'available';
                    advisor.activeCustomerId = null;
                    // Do NOT automatically extract from waiting area - advisor must press "Next"
                }
                advisor.updatedAt = now;
            }
        } else if (action === 'transfer') {
            // Transfer to another advisor
            const { transferToAdvisorId } = req.body;
            const transferToAdvisor = queueData.employees.find(e => e.id === String(transferToAdvisorId) && e.type === 'advisor');
            
            if (!transferToAdvisor) {
                return res.status(404).json({ error: 'Transfer advisor not found' });
            }
            
            // Remove from waiting list if it's there
            if (queueData.waitingList && customerIndex >= 0) {
                queueData.waitingList.splice(customerIndex, 1);
                // Recalculate waiting numbers for the original advisor
                recalculateWaitingNumbers(queueData);
            }
            
            customer.status = 'transfer';
            customer.transferredAt = now;
            customer.transferredFrom = String(advisorId);
            customer.transferredTo = String(transferToAdvisorId);
            
            // Create new accepted customer for the new advisor
            const newCustomer = {
                ...customer,
                id: `customer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                employeeId: String(transferToAdvisorId),
                status: 'accepted',
                acceptedAt: now,
                assignedAt: now,
                transferredFrom: String(advisorId),
                transferredAt: now
            };
            delete newCustomer.transferredTo;
            queueData.customers.push(newCustomer);
            
            // Update both advisors
            const advisor = queueData.employees.find(e => e.id === String(advisorId) && e.type === 'advisor');
            if (advisor) {
                const hasMoreAccepted = queueData.customers.some(c => 
                    c.employeeId === String(advisorId) && c.status === 'accepted' && !c.completedAt
                );
                if (!hasMoreAccepted) {
                    advisor.status = 'available';
                }
                advisor.updatedAt = now;
            }
            
            transferToAdvisor.status = 'busy';
            transferToAdvisor.updatedAt = now;
        }
        
        saveQueueData(queueData);
        broadcastQueueUpdate();
        
        res.json({ success: true, data: queueData, customer: customer });
    } catch (error) {
        console.error('Error processing customer action:', error);
        res.status(500).json({ error: 'Failed to process customer action' });
    }
});

// API: Get next customer from waiting area (advisor presses "Next" button)
app.post('/api/queue/advisor/next-customer', (req, res) => {
    try {
        const { advisorId } = req.body;
        
        if (!advisorId) {
            return res.status(400).json({ error: 'advisorId is required' });
        }
        
        const queueData = getQueueData();
        
        // Check if advisor is signed in
        const advisor = queueData.employees.find(e => e.id === String(advisorId) && e.type === 'advisor');
        if (!advisor || !advisor.assignedAdvisorId) {
            return res.status(400).json({ error: 'Advisor is not signed in' });
        }
        
        // Mark any active customers as "served" and set status to available
        const activeCustomers = (queueData.customers || []).filter(c => 
            c.employeeId === String(advisorId) && 
            (c.status === 'active' || c.status === 'accepted') && 
            !c.completedAt
        );
        
        const now = getSaudiTimeString();
        activeCustomers.forEach(customer => {
            customer.status = 'served';
            customer.completedAt = now;
            customer.servedAt = now;
            
            // Log customer completion
            logAction({
                action: 'customer_served',
                customerId: customer.id,
                customerName: customer.customerName,
                customerPhone: customer.customerPhone || 'N/A',
                advisorId: advisorId,
                advisorName: advisor.displayName || advisor.name,
                servedAt: now,
                completedAt: now
            });
        });
        
        // Clear active customer tracking and set status to available
        advisor.activeCustomerId = null;
        advisor.status = 'available';
        advisor.updatedAt = now;
        
        // Check if advisor already has an assigned customer (from waiting list)
        const hasAssignedCustomer = (queueData.waitingList || []).some(w => 
            w.advisorId === String(advisorId) && w.status === 'assigned'
        );
        
        // Only extract if advisor doesn't already have an assigned customer
        if (!hasAssignedCustomer) {
            // Extract oldest customer from waiting area and assign to advisor
            extractFromWaitingArea(queueData, String(advisorId));
        }
        
        // Get updated waiting list for this advisor
        const waitingList = (queueData.waitingList || []).filter(w => 
            w.advisorId === String(advisorId) && (w.status === 'waiting' || w.status === 'assigned')
        );
        
        // Get served customers for this advisor
        const servedCustomers = (queueData.customers || []).filter(c => 
            c.employeeId === String(advisorId) && 
            c.status === 'served' && 
            c.completedAt
        ).sort((a, b) => new Date(b.servedAt || b.completedAt) - new Date(a.servedAt || a.completedAt)); // Most recent first
        
        saveQueueData(queueData);
        broadcastQueueUpdate();
        
        res.json({ 
            success: true, 
            message: waitingList.length > 0 ? 'Next customer assigned' : 'No customers in waiting area',
            waitingList: waitingList,
            servedCustomers: servedCustomers,
            data: queueData
        });
    } catch (error) {
        console.error('Error getting next customer:', error);
        res.status(500).json({ error: 'Failed to get next customer' });
    }
});

// API: Get employee dashboard data
app.get('/api/queue/employee/:employeeId/dashboard', (req, res) => {
    try {
        const employeeId = req.params.employeeId;
        const queueData = getQueueData();
        
        const employee = queueData.employees.find(e => e.id === String(employeeId) && (!e.type || e.type !== 'advisor'));
        if (!employee) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        
        // Get active customers (not completed, not missed, not rejected, not served, not transfer)
        const activeCustomers = (queueData.customers || []).filter(c => 
            c.employeeId === String(employeeId) && 
            !c.completedAt && 
            c.status !== 'missed' && 
            c.status !== 'rejected' && 
            c.status !== 'served' &&
            c.status !== 'transfer'
        );
        
        // Get today's served customers count
        const today = new Date().toDateString();
        const todayServed = (queueData.customers || []).filter(c => 
            c.employeeId === String(employeeId) && 
            c.status === 'served' &&
            c.servedAt &&
            new Date(c.servedAt).toDateString() === today
        ).length;
        
        // Get total served customers count
        const totalServed = (queueData.customers || []).filter(c => 
            c.employeeId === String(employeeId) && 
            c.status === 'served'
        ).length;
        
        res.json({
            success: true,
            employee: employee,
            activeCustomers: activeCustomers,
            todayServedCount: todayServed,
            totalServedCount: totalServed
        });
    } catch (error) {
        console.error('Error getting employee dashboard:', error);
        res.status(500).json({ error: 'Failed to get employee dashboard' });
    }
});

// API: Employee customer action (completed)
app.post('/api/queue/employee/customer-action', (req, res) => {
    try {
        const { employeeId, customerId, action, notes } = req.body;
        
        if (!employeeId || !customerId || !action) {
            return res.status(400).json({ error: 'employeeId, customerId, and action are required' });
        }
        
        if (action !== 'completed') {
            return res.status(400).json({ error: 'action must be "completed"' });
        }
        
        const queueData = getQueueData();
        
        // Find customer
        const customerIndex = queueData.customers.findIndex(c => 
            c.id === customerId && c.employeeId === String(employeeId) && !c.completedAt
        );
        
        if (customerIndex === -1) {
            return res.status(404).json({ error: 'Customer not found' });
        }
        
        const customer = queueData.customers[customerIndex];
        const now = getSaudiTimeString();
        const today = new Date().toDateString();
        
        // Mark as served/completed
        customer.status = 'served';
        customer.servedAt = now;
        customer.completedAt = now;
        if (notes) {
            customer.notes = notes;
        }
        
        // Update employee status
        const employee = queueData.employees.find(e => e.id === String(employeeId) && (!e.type || e.type !== 'advisor'));
        if (employee) {
            // Check if employee has more active customers, otherwise set to available
            const hasMoreActive = queueData.customers.some(c => 
                c.employeeId === String(employeeId) && 
                !c.completedAt && 
                c.status !== 'missed' && 
                c.status !== 'rejected' && 
                c.status !== 'served' &&
                c.status !== 'transfer'
            );
            if (!hasMoreActive) {
                employee.status = 'available';
            }
            employee.updatedAt = now;
        }
        
        saveQueueData(queueData);
        broadcastQueueUpdate();
        
        res.json({ success: true, data: queueData, customer: customer });
    } catch (error) {
        console.error('Error processing employee customer action:', error);
        res.status(500).json({ error: 'Failed to process customer action' });
    }
});

// API: Generate Excel report for admin
app.post('/api/queue/export-excel', authenticateBackend, (req, res) => {
    try {
        const XLSX = require('xlsx');
        const logs = getQueueLog();
        const queueData = getQueueData();
        
        // Filter logs for today or all if no date specified
        const targetDate = req.query.date || getSaudiDateString();
        const dayLogs = logs.filter(log => log.date === targetDate);
        
        // Create workbook
        const workbook = XLSX.utils.book_new();
        
        // Prepare data matching the new format - get all customer records for the date
        // Group by customerId to get complete customer journey
        const customerRecords = {};
        
        // First, collect all customer-related logs for the date
        dayLogs.forEach(log => {
            if (log.customerId && (log.action === 'customer_added_to_waiting' || log.action === 'customer_accepted' || log.action === 'customer_completed' || log.action === 'customer_served' || log.action === 'customer_admin_handled' || log.action === 'guest_experience_added' || log.action === 'customer_added_to_waiting_area' || log.action === 'customer_extracted_from_waiting_area')) {
                if (!customerRecords[log.customerId]) {
                    customerRecords[log.customerId] = {
                        customerId: log.customerId,
                        customerName: log.customerName || '',
                        customerPhone: log.customerPhone || 'N/A',
                        promoter: log.addedBy || 'N/A',
                        advisorId: log.advisorId || '',
                        advisorName: log.advisorName || '',
                        assignTime: '',
                        assignDate: log.date || '',
                        acceptedTime: '',
                        completedTime: '',
                        waitingNumber: log.waitingNumber || 'N/A',
                        status: 'waiting',
                        sourceType: log.sourceType || 'WALK_IN',
                        tag: log.tag || '',
                        handledByAdmin: false,
                        adminHandledAt: '',
                        waitExceeded5Min: false
                    };
                }
                
                // Update record based on action
                if (log.action === 'customer_added_to_waiting') {
                    customerRecords[log.customerId].assignTime = log.time || '';
                    customerRecords[log.customerId].assignDate = log.date || '';
                    customerRecords[log.customerId].sourceType = log.sourceType || customerRecords[log.customerId].sourceType || 'WALK_IN';
                    customerRecords[log.customerId].tag = log.tag || customerRecords[log.customerId].tag || '';
                    customerRecords[log.customerId].assignedBy = log.assignedBy || 'promoter'; // Track assignment source
                } else if (log.action === 'customer_extracted_from_waiting_area') {
                    // Track when advisor extracts from waiting area
                    customerRecords[log.customerId].assignedBy = log.assignedBy || 'advisor';
                    customerRecords[log.customerId].originalAssignedBy = log.originalAssignedBy || 'promoter';
                } else if (log.action === 'customer_added_to_waiting_area') {
                    // Track when promoter adds to waiting area
                    customerRecords[log.customerId].assignedBy = log.assignedBy || 'promoter';
                    customerRecords[log.customerId].assignTime = log.time || '';
                    customerRecords[log.customerId].assignDate = log.date || '';
                    customerRecords[log.customerId].sourceType = log.sourceType || customerRecords[log.customerId].sourceType || 'WALK_IN';
                    customerRecords[log.customerId].tag = log.tag || customerRecords[log.customerId].tag || '';
                } else if (log.action === 'customer_accepted') {
                    customerRecords[log.customerId].acceptedTime = log.time || '';
                    customerRecords[log.customerId].status = 'accepted';
                } else if (log.action === 'customer_completed' || log.action === 'customer_served') {
                    customerRecords[log.customerId].completedTime = log.time || '';
                    customerRecords[log.customerId].status = 'served'; // Mark as served when next customer is pressed
                } else if (log.action === 'customer_admin_handled') {
                    customerRecords[log.customerId].status = 'ADMIN_HANDLED';
                    customerRecords[log.customerId].handledByAdmin = true;
                    customerRecords[log.customerId].adminHandledAt = log.adminHandledAt || log.time || '';
                    customerRecords[log.customerId].waitExceeded5Min = log.waitExceeded5Min || false;
                } else if (log.action === 'guest_experience_added') {
                    customerRecords[log.customerId].sourceType = 'GUEST_EXPERIENCE';
                    customerRecords[log.customerId].status = 'GUEST_EXPERIENCE';
                }
                
                // Update escalation flags
                if (log.waitExceeded5Min) {
                    customerRecords[log.customerId].waitExceeded5Min = true;
                }
                if (log.handledByAdmin) {
                    customerRecords[log.customerId].handledByAdmin = true;
                    customerRecords[log.customerId].adminHandledAt = log.adminHandledAt || customerRecords[log.customerId].adminHandledAt || '';
                }
            }
        });
        
        // Convert to array and format for Excel
        const exportData = Object.values(customerRecords).map(record => {
            // Calculate time waited after accepted
            let timeWaitedAfterAccepted = '';
            if (record.acceptedTime && record.assignTime) {
                // Find the actual timestamps from logs
                const addedLog = dayLogs.find(l => 
                    l.customerId === record.customerId && 
                    l.action === 'customer_added_to_waiting'
                );
                const acceptedLog = dayLogs.find(l => 
                    l.customerId === record.customerId && 
                    l.action === 'customer_accepted'
                );
                
                if (addedLog && acceptedLog && addedLog.timestamp && acceptedLog.timestamp) {
                    const waitTime = new Date(acceptedLog.timestamp) - new Date(addedLog.timestamp);
                    const minutes = Math.round(waitTime / 60000);
                    timeWaitedAfterAccepted = `${minutes} min`;
                }
            }
            
            // Determine customer category based on sourceType/tag
            let customerCategory = 'assigned to advisor';
            if (record.sourceType === 'GUEST_EXPERIENCE') {
                customerCategory = 'guest experince';
            } else if (record.sourceType === 'SECOND_VISIT' || record.tag === 'SECOND VISIT') {
                customerCategory = 'second visit';
            } else if (record.sourceType === 'PHONE_CALL' || record.tag === 'PHONE CALL') {
                customerCategory = 'phone call';
            }
            
            // Determine status: "done" if served/completed/ADMIN_HANDLED/GUEST_EXPERIENCE, otherwise "under process"
            let status = 'under process';
            if (record.status === 'served' || record.status === 'completed' || record.status === 'ADMIN_HANDLED' || record.status === 'GUEST_EXPERIENCE' || record.sourceType === 'GUEST_EXPERIENCE') {
                status = 'done';
            }
            
            // Format assign time (HH:MM:SS)
            let assignTimeFormatted = '';
            if (record.assignTime) {
                try {
                    // If assignTime is just a time string (HH:MM:SS), combine with assignDate
                    if (record.assignTime.includes(':') && !record.assignTime.includes('T') && record.assignDate) {
                        const dateTimeString = `${record.assignDate}T${record.assignTime}`;
                        const timeDate = new Date(dateTimeString);
                        if (!isNaN(timeDate.getTime())) {
                            assignTimeFormatted = timeDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                        } else {
                            // If date parsing fails, just format the time string
                            const timeParts = record.assignTime.split(':');
                            if (timeParts.length >= 2) {
                                assignTimeFormatted = `${timeParts[0]}:${timeParts[1]}${timeParts[2] ? ':' + timeParts[2] : ''}`;
                            }
                        }
                    } else {
                        // Try parsing as full date-time string
                        const timeDate = new Date(record.assignTime);
                        if (!isNaN(timeDate.getTime())) {
                            assignTimeFormatted = timeDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                        } else {
                            assignTimeFormatted = record.assignTime; // Use as-is if can't parse
                        }
                    }
                } catch (e) {
                    // If parsing fails, try to format the time string directly
                    if (record.assignTime.includes(':')) {
                        const timeParts = record.assignTime.split(':');
                        if (timeParts.length >= 2) {
                            assignTimeFormatted = `${timeParts[0]}:${timeParts[1]}${timeParts[2] ? ':' + timeParts[2] : ''}`;
                        }
                    } else {
                        assignTimeFormatted = record.assignTime;
                    }
                }
            }
            
            // Format accepted time (HH:MM:SS)
            let acceptedTimeFormatted = '';
            if (record.acceptedTime) {
                try {
                    // If acceptedTime is just a time string (HH:MM:SS), combine with assignDate
                    if (record.acceptedTime.includes(':') && !record.acceptedTime.includes('T') && record.assignDate) {
                        const dateTimeString = `${record.assignDate}T${record.acceptedTime}`;
                        const timeDate = new Date(dateTimeString);
                        if (!isNaN(timeDate.getTime())) {
                            acceptedTimeFormatted = timeDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                        } else {
                            // If date parsing fails, just format the time string
                            const timeParts = record.acceptedTime.split(':');
                            if (timeParts.length >= 2) {
                                acceptedTimeFormatted = `${timeParts[0]}:${timeParts[1]}${timeParts[2] ? ':' + timeParts[2] : ''}`;
                            }
                        }
                    } else {
                        // Try parsing as full date-time string
                        const timeDate = new Date(record.acceptedTime);
                        if (!isNaN(timeDate.getTime())) {
                            acceptedTimeFormatted = timeDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                        } else {
                            acceptedTimeFormatted = record.acceptedTime; // Use as-is if can't parse
                        }
                    }
                } catch (e) {
                    // If parsing fails, try to format the time string directly
                    if (record.acceptedTime.includes(':')) {
                        const timeParts = record.acceptedTime.split(':');
                        if (timeParts.length >= 2) {
                            acceptedTimeFormatted = `${timeParts[0]}:${timeParts[1]}${timeParts[2] ? ':' + timeParts[2] : ''}`;
                        }
                    } else {
                        acceptedTimeFormatted = record.acceptedTime;
                    }
                }
            }
            
            // Format assign date (M/D/YYYY)
            let assignDateFormatted = '';
            if (record.assignDate) {
                try {
                    const dateObj = new Date(record.assignDate);
                    assignDateFormatted = `${dateObj.getMonth() + 1}/${dateObj.getDate()}/${dateObj.getFullYear()}`;
                } catch (e) {
                    assignDateFormatted = record.assignDate;
                }
            }
            
            return {
                'Promoter': record.promoter || '',
                'Customer Name': record.customerName || '',
                'Phone Number': record.customerPhone || '',
                'Assigned To': record.status === 'ADMIN_HANDLED' ? 'ADMIN HANDLED' : (record.advisorName || record.advisorId || ''),
                'Assign Time': assignTimeFormatted,
                'Assign Date': assignDateFormatted,
                'Accepted By Advisor Time': acceptedTimeFormatted,
                'Customer Category': customerCategory,
                'Time Waited After Accepted': timeWaitedAfterAccepted,
                'Queue Position': record.waitingNumber || '',
                'Status': status
            };
        });
        
        // Create worksheet
        const worksheet = XLSX.utils.json_to_sheet(exportData);
        
        // Set column widths
        const colWidths = [
            { wch: 15 }, // Promoter
            { wch: 20 }, // Customer Name
            { wch: 15 }, // Phone Number
            { wch: 18 }, // Assigned To
            { wch: 12 }, // Assign Time
            { wch: 12 }, // Assign Date
            { wch: 20 }, // Accepted By Advisor Time
            { wch: 18 }, // Customer Category
            { wch: 22 }, // Time Waited After Accepted
            { wch: 15 }, // Queue Position
            { wch: 15 }  // Status
        ];
        worksheet['!cols'] = colWidths;
        
        // Add worksheet to workbook
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Queue Log');
        
        // Generate buffer
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        
        // Set response headers
        const filename = `queue-report-${targetDate}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        res.send(buffer);
    } catch (error) {
        console.error('Error generating Excel report:', error);
        res.status(500).json({ error: 'Failed to generate Excel report' });
    }
});

// API: Clear all queue data (admin only)
app.post('/api/queue/clear-all-data', authenticateBackend, (req, res) => {
    try {
        const queueData = getQueueData();
        
        // Reset queue data to initial state
        const initialEmployees = [
            { id: '1', name: 'Employee 1', status: 'available', updatedAt: new Date().toISOString(), updatedBy: 'system' },
            { id: '2', name: 'Employee 2', status: 'available', updatedAt: new Date().toISOString(), updatedBy: 'system' },
            { id: '3', name: 'Employee 3', status: 'available', updatedAt: new Date().toISOString(), updatedBy: 'system' },
            { id: '4', name: 'Employee 4', status: 'available', updatedAt: new Date().toISOString(), updatedBy: 'system' },
            { id: '5', name: 'Employee 5', status: 'available', updatedAt: new Date().toISOString(), updatedBy: 'system' },
            { id: '6', name: 'Employee 6', status: 'available', updatedAt: new Date().toISOString(), updatedBy: 'system' },
            { id: '7', name: 'Employee 7', status: 'available', updatedAt: new Date().toISOString(), updatedBy: 'system' },
            { id: '8', name: 'Employee 8', status: 'available', updatedAt: new Date().toISOString(), updatedBy: 'system' },
            // Sales Advisors
            { id: 'S1', name: 'ali', status: 'out_of_office', updatedAt: new Date().toISOString(), updatedBy: 'system', type: 'advisor', dailyCustomersCount: 0, lastResetDate: getSaudiDateString() },
            { id: 'S2', name: 'muteb', status: 'out_of_office', updatedAt: new Date().toISOString(), updatedBy: 'system', type: 'advisor', dailyCustomersCount: 0, lastResetDate: getSaudiDateString() },
            { id: 'S3', name: 'lujain', status: 'out_of_office', updatedAt: new Date().toISOString(), updatedBy: 'system', type: 'advisor', dailyCustomersCount: 0, lastResetDate: getSaudiDateString() },
            { id: 'S4', name: 'al jawhara', status: 'out_of_office', updatedAt: new Date().toISOString(), updatedBy: 'system', type: 'advisor', dailyCustomersCount: 0, lastResetDate: getSaudiDateString() },
            { id: 'S5', name: 'eissa', status: 'out_of_office', updatedAt: new Date().toISOString(), updatedBy: 'system', type: 'advisor', dailyCustomersCount: 0, lastResetDate: getSaudiDateString() },
            { id: 'S6', name: 'kholod', status: 'out_of_office', updatedAt: new Date().toISOString(), updatedBy: 'system', type: 'advisor', dailyCustomersCount: 0, lastResetDate: getSaudiDateString() },
            { id: 'S7', name: 'haneen', status: 'out_of_office', updatedAt: new Date().toISOString(), updatedBy: 'system', type: 'advisor', dailyCustomersCount: 0, lastResetDate: getSaudiDateString() },
            { id: 'S8', name: 'raoom', status: 'out_of_office', updatedAt: new Date().toISOString(), updatedBy: 'system', type: 'advisor', dailyCustomersCount: 0, lastResetDate: getSaudiDateString() }
        ];
        
        const resetData = {
            employees: initialEmployees,
            customers: [],
            waitingList: [],
            waitingArea: {
                id: 'WAITING_AREA',
                name: 'Waiting Area',
                customers: []
            },
            guestExperience: {
                total: 0,
                today: 0,
                records: [],
                lastDate: getSaudiDateString()
            },
            lastAssignedAdvisorIndex: 0
        };
        
        fs.writeFileSync(QUEUE_FILE, JSON.stringify(resetData, null, 2));
        
        // Clear queue log
        fs.writeFileSync(QUEUE_LOG_FILE, JSON.stringify([], null, 2));
        
        // Broadcast update to all connected clients
        broadcastQueueUpdate();
        
        res.json({ 
            success: true, 
            message: 'All queue data has been cleared successfully. System reset to initial state.',
            data: resetData
        });
    } catch (error) {
        console.error('Error clearing queue data:', error);
        res.status(500).json({ error: 'Failed to clear queue data' });
    }
});

// API: Get report data for admin display (JSON format)
app.get('/api/queue/report-data', authenticateBackend, (req, res) => {
    try {
        const logs = getQueueLog();
        const queueData = getQueueData();
        
        // Filter logs for today or all if no date specified
        const targetDate = req.query.date || getSaudiDateString();
        const dayLogs = logs.filter(log => log.date === targetDate);
        
        // Prepare data matching Excel format - get all customer records for the date
        // Group by customerId to get complete customer journey
        const customerRecords = {};
        
        // First, collect all customer-related logs for the date
        dayLogs.forEach(log => {
            if (log.customerId && (log.action === 'customer_added_to_waiting' || log.action === 'customer_accepted' || log.action === 'customer_completed' || log.action === 'customer_served' || log.action === 'customer_admin_handled' || log.action === 'guest_experience_added' || log.action === 'customer_added_to_waiting_area' || log.action === 'customer_extracted_from_waiting_area')) {
                if (!customerRecords[log.customerId]) {
                    customerRecords[log.customerId] = {
                        customerId: log.customerId,
                        customerName: log.customerName || '',
                        customerPhone: log.customerPhone || 'N/A',
                        promoter: log.addedBy || 'N/A',
                        advisorId: log.advisorId || '',
                        advisorName: log.advisorName || '',
                        assignTime: '',
                        assignDate: log.date || '',
                        acceptedTime: '',
                        completedTime: '',
                        waitingNumber: log.waitingNumber || 'N/A',
                        status: 'waiting',
                        sourceType: log.sourceType || 'WALK_IN',
                        tag: log.tag || '',
                        handledByAdmin: false,
                        adminHandledAt: '',
                        waitExceeded5Min: false
                    };
                }
                
                // Update record based on action
                if (log.action === 'customer_added_to_waiting') {
                    customerRecords[log.customerId].assignTime = log.time || '';
                    customerRecords[log.customerId].assignDate = log.date || '';
                    customerRecords[log.customerId].sourceType = log.sourceType || customerRecords[log.customerId].sourceType || 'WALK_IN';
                    customerRecords[log.customerId].tag = log.tag || customerRecords[log.customerId].tag || '';
                } else if (log.action === 'customer_accepted') {
                    customerRecords[log.customerId].acceptedTime = log.time || '';
                    customerRecords[log.customerId].status = 'accepted';
                } else if (log.action === 'customer_completed' || log.action === 'customer_served') {
                    customerRecords[log.customerId].completedTime = log.time || '';
                    customerRecords[log.customerId].status = 'completed';
                } else if (log.action === 'customer_admin_handled') {
                    customerRecords[log.customerId].status = 'ADMIN_HANDLED';
                    customerRecords[log.customerId].handledByAdmin = true;
                    customerRecords[log.customerId].adminHandledAt = log.adminHandledAt || log.time || '';
                    customerRecords[log.customerId].waitExceeded5Min = log.waitExceeded5Min || false;
                }
                
                // Update escalation flags
                if (log.waitExceeded5Min) {
                    customerRecords[log.customerId].waitExceeded5Min = true;
                }
                if (log.handledByAdmin) {
                    customerRecords[log.customerId].handledByAdmin = true;
                    customerRecords[log.customerId].adminHandledAt = log.adminHandledAt || customerRecords[log.customerId].adminHandledAt || '';
                }
            }
        });
        
        // Convert to array and calculate wait times
        const reportData = Object.values(customerRecords).map(record => {
            // Calculate time waited after accepted
            let timeWaitedAfterAccepted = '';
            if (record.acceptedTime && record.assignTime) {
                // Find the actual timestamps from logs
                const addedLog = dayLogs.find(l => 
                    l.customerId === record.customerId && 
                    l.action === 'customer_added_to_waiting'
                );
                const acceptedLog = dayLogs.find(l => 
                    l.customerId === record.customerId && 
                    l.action === 'customer_accepted'
                );
                
                if (addedLog && acceptedLog && addedLog.timestamp && acceptedLog.timestamp) {
                    const waitTime = new Date(acceptedLog.timestamp) - new Date(addedLog.timestamp);
                    const minutes = Math.round(waitTime / 60000);
                    timeWaitedAfterAccepted = `${minutes} min`;
                }
            }
            
            // Get advisor status (try to get from logs or current status)
            let advisorStatusAtTime = '';
            if (record.advisorId) {
                const advisor = queueData.employees.find(e => e.id === record.advisorId && e.type === 'advisor');
                if (advisor) {
                    advisorStatusAtTime = advisor.status || '';
                }
            }
            
            // Determine customer category based on sourceType/tag
            let customerCategory = 'assigned to advisor';
            if (record.sourceType === 'GUEST_EXPERIENCE') {
                customerCategory = 'guest experince';
            } else if (record.sourceType === 'SECOND_VISIT' || record.tag === 'SECOND VISIT') {
                customerCategory = 'second visit';
            } else if (record.sourceType === 'PHONE_CALL' || record.tag === 'PHONE CALL') {
                customerCategory = 'phone call';
            }
            
            // Determine status: "done" if served/completed/ADMIN_HANDLED/GUEST_EXPERIENCE, otherwise "under process"
            let status = 'under process';
            if (record.status === 'served' || record.status === 'completed' || record.status === 'ADMIN_HANDLED' || record.status === 'GUEST_EXPERIENCE' || record.sourceType === 'GUEST_EXPERIENCE') {
                status = 'done';
            }
            
            // Format times
            let assignTimeFormatted = record.assignTime || '';
            if (assignTimeFormatted !== '' && record.assignTime) {
                try {
                    // If assignTime is just a time string (HH:MM:SS), combine with assignDate
                    if (record.assignTime.includes(':') && !record.assignTime.includes('T') && record.assignDate) {
                        const dateTimeString = `${record.assignDate}T${record.assignTime}`;
                        const timeDate = new Date(dateTimeString);
                        if (!isNaN(timeDate.getTime())) {
                            assignTimeFormatted = timeDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                        } else {
                            // If date parsing fails, just format the time string
                            const timeParts = record.assignTime.split(':');
                            if (timeParts.length >= 2) {
                                assignTimeFormatted = `${timeParts[0]}:${timeParts[1]}${timeParts[2] ? ':' + timeParts[2] : ''}`;
                            }
                        }
                    } else {
                        // Try parsing as full date-time string
                        const timeDate = new Date(record.assignTime);
                        if (!isNaN(timeDate.getTime())) {
                            assignTimeFormatted = timeDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                        } else {
                            assignTimeFormatted = record.assignTime; // Use as-is if can't parse
                        }
                    }
                } catch (e) {
                    // If parsing fails, try to format the time string directly
                    if (record.assignTime.includes(':')) {
                        const timeParts = record.assignTime.split(':');
                        if (timeParts.length >= 2) {
                            assignTimeFormatted = `${timeParts[0]}:${timeParts[1]}${timeParts[2] ? ':' + timeParts[2] : ''}`;
                        }
                    }
                }
            }
            
            let acceptedTimeFormatted = record.acceptedTime || '';
            if (acceptedTimeFormatted !== '' && record.acceptedTime) {
                try {
                    // If acceptedTime is just a time string (HH:MM:SS), combine with assignDate
                    if (record.acceptedTime.includes(':') && !record.acceptedTime.includes('T') && record.assignDate) {
                        const dateTimeString = `${record.assignDate}T${record.acceptedTime}`;
                        const timeDate = new Date(dateTimeString);
                        if (!isNaN(timeDate.getTime())) {
                            acceptedTimeFormatted = timeDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                        } else {
                            // If date parsing fails, just format the time string
                            const timeParts = record.acceptedTime.split(':');
                            if (timeParts.length >= 2) {
                                acceptedTimeFormatted = `${timeParts[0]}:${timeParts[1]}${timeParts[2] ? ':' + timeParts[2] : ''}`;
                            }
                        }
                    } else {
                        // Try parsing as full date-time string
                        const timeDate = new Date(record.acceptedTime);
                        if (!isNaN(timeDate.getTime())) {
                            acceptedTimeFormatted = timeDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                        } else {
                            acceptedTimeFormatted = record.acceptedTime; // Use as-is if can't parse
                        }
                    }
                } catch (e) {
                    // If parsing fails, try to format the time string directly
                    if (record.acceptedTime.includes(':')) {
                        const timeParts = record.acceptedTime.split(':');
                        if (timeParts.length >= 2) {
                            acceptedTimeFormatted = `${timeParts[0]}:${timeParts[1]}${timeParts[2] ? ':' + timeParts[2] : ''}`;
                        }
                    }
                }
            }
            
            // Format date
            let assignDateFormatted = record.assignDate || '';
            if (assignDateFormatted !== '' && record.assignDate) {
                try {
                    const dateObj = new Date(record.assignDate);
                    assignDateFormatted = `${dateObj.getMonth() + 1}/${dateObj.getDate()}/${dateObj.getFullYear()}`;
                } catch (e) {}
            }
            
            return {
                promoter: record.promoter || '',
                customerName: record.customerName || '',
                customerPhone: record.customerPhone || '',
                assignedTo: record.status === 'ADMIN_HANDLED' ? 'ADMIN HANDLED' : (record.advisorName || record.advisorId || ''),
                assignTime: assignTimeFormatted,
                assignDate: assignDateFormatted,
                acceptedByAdvisorTime: acceptedTimeFormatted,
                customerCategory: customerCategory,
                timeWaitedAfterAccepted: timeWaitedAfterAccepted,
                queuePosition: record.waitingNumber || '',
                status: status,
                sourceType: record.sourceType || 'WALK_IN',
                tag: record.tag || '',
                handledByAdmin: record.handledByAdmin || false,
                adminHandledAt: record.adminHandledAt || '',
                waitExceeded5Min: record.waitExceeded5Min || false
            };
        });
        
        res.json({ success: true, data: reportData, date: targetDate });
    } catch (error) {
        console.error('Error getting report data:', error);
        res.status(500).json({ error: 'Failed to get report data' });
    }
});

// Daily reset scheduler - resets daily counts at midnight (12 AM)
function scheduleDailyReset() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0); // Set to midnight (12:00 AM)
    
    const msUntilMidnight = tomorrow.getTime() - now.getTime();
    
    console.log(`⏰ Daily reset scheduled for ${tomorrow.toLocaleString()}`);
    
    setTimeout(() => {
        performDailyReset();
        // Schedule next reset (24 hours later)
        setInterval(performDailyReset, 24 * 60 * 60 * 1000);
    }, msUntilMidnight);
}

// Perform daily reset at midnight
function performDailyReset() {
    try {
        console.log('🔄 Performing daily reset at midnight...');
        const queueData = getQueueData();
        const today = getSaudiDateString(); // Use consistent date format
        let resetCount = 0;
        
        // Reset daily customer counts for all advisors
        if (queueData.employees) {
            queueData.employees.forEach(emp => {
                if (emp.type === 'advisor') {
                    const lastResetDate = emp.lastResetDate || '';
                    if (lastResetDate !== today) {
                        emp.dailyCustomersCount = 0;
                        emp.lastResetDate = today;
                        resetCount++;
                    }
                }
            });
        }
        
        // Log the reset action
        logAction({
            action: 'daily_reset',
            date: today,
            advisorsReset: resetCount,
            resetBy: 'system',
            timestamp: new Date().toISOString()
        });
        
        saveQueueData(queueData);
        broadcastQueueUpdate();
        
        console.log(`✅ Daily reset completed. Reset ${resetCount} advisor(s).`);
    } catch (error) {
        console.error('❌ Error performing daily reset:', error);
    }
}

// Initialize daily reset scheduler on server start
scheduleDailyReset();

wss.on('connection', (ws, req) => {
    console.log('Client connected to WebSocket');

    try {
        const store = loadShowroomBoardStore();
        ws.send(JSON.stringify({
            type: 'showroom_updated',
            data: { success: true, ...showroomBoardPayload(store) }
        }));
    } catch (e) {
        console.error('Showroom initial WS push error:', e.message);
    }

    const queueData = getQueueData();
    ws.send(JSON.stringify({ type: 'queue_updated', data: queueData }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
            }
            if (data.type === 'subscribe_showroom') {
                const store = loadShowroomBoardStore();
                ws.send(JSON.stringify({
                    type: 'showroom_updated',
                    data: { success: true, ...showroomBoardPayload(store) }
                }));
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('Client disconnected from WebSocket');
    });
});


