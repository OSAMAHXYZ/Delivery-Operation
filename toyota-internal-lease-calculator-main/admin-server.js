const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Data file path
const DATA_FILE = path.join(__dirname, 'admin-data.json');

// Default bank settings
const defaultBanks = [
    { id: 1, name: 'Bank 1', interestRate: 5.5, maxSalaryPercentage: 33, minDownPayment: 0, profitRate: 3.5, insuranceRate: 2.5, balloonPayment: 40, commissionRate: 1.8, hasSpecialOffer: true, specialOfferFirstPercent: 50, specialOfferSecondPercent: 50, specialOfferYears: 2, specialOfferProfitRate: 0, specialOfferCrownProfitRate: 1.54, specialOfferAdminFees: 1 },
    { 
        id: 2, 
        name: 'Bank Al-INMA', 
        interestRate: 2.5, 
        maxSalaryPercentage: 33, 
        minDownPayment: 0, 
        profitRate: 3.0, 
        insuranceRate: 2.5, 
        balloonPayment: 40, 
        commissionRate: 1.0, 
        adminFees: 1.0, 
        campaign: "Q4 2025",
        hasSpecialOffer: false,
        specialOfferFirstPercent: 50,
        specialOfferSecondPercent: 50,
        specialOfferYears: 0,
        specialRates: {
            'Raize_2024': { ST: 1.4, NST: 1.8 },
            'Urban_Cruiser_2025': { ST: 1.8, NST: 2.2 },
            'Fortuner_2025': { ST: 1.8, NST: 2.2 },
            'Veloz_2025': { ST: 1.8, NST: 2.2 },
            'Hilux_DC_2025': { ST: 1.8, NST: 2.2 },
            'Hilux_SC_2025': { ST: 1.8, NST: 2.2 },
            'Raize_2026': { ST: 2.4, NST: 2.8 },
            'Urban_Cruiser_2026': { ST: 2.4, NST: 2.8 },
            'Innova_2025': { ST: 2.4, NST: 2.8 },
            'Highlander_2025': { ST: 2.4, NST: 2.8 },
            'LC300_Diesel_Hybrid': { ST: 2.4, NST: 2.8 },
            'Corolla_Cross_2025': { ST: 2.5, NST: 2.9 },
            'Corolla_2025': { ST: 2.5, NST: 2.9 },
            'Crown_2026': { ST: 2.8, NST: 3.2 }
        }
    },
    { id: 3, name: 'Bank 3', interestRate: 6.2, maxSalaryPercentage: 30, minDownPayment: 0, profitRate: 3.5, insuranceRate: 2.5, balloonPayment: 40, commissionRate: 2.0, hasSpecialOffer: false, specialOfferFirstPercent: 50, specialOfferSecondPercent: 50, specialOfferYears: 0 },
    { id: 4, name: 'Bank 4', interestRate: 10.0, maxSalaryPercentage: 0, minDownPayment: 0, profitRate: 3.5, insuranceRate: 2.5, balloonPayment: 35, commissionRate: 1.0, hasSpecialOffer: false, specialOfferFirstPercent: 50, specialOfferSecondPercent: 50, specialOfferYears: 0 },
    { id: 5, name: 'Bank 5', interestRate: 5.8, maxSalaryPercentage: 32, minDownPayment: 0, profitRate: 3.5, insuranceRate: 2.5, balloonPayment: 40, commissionRate: 2.2, hasSpecialOffer: false, specialOfferFirstPercent: 50, specialOfferSecondPercent: 50, specialOfferYears: 0 },
    { id: 6, name: 'Bank 6', interestRate: 4.5, maxSalaryPercentage: 35, minDownPayment: 0, profitRate: 3.5, insuranceRate: 2.5, balloonPayment: 40, commissionRate: 1.6, hasSpecialOffer: false, specialOfferFirstPercent: 50, specialOfferSecondPercent: 50, specialOfferYears: 0 },
    { id: 7, name: 'BSF bank', interestRate: 6.0, maxSalaryPercentage: 0, minDownPayment: 0, profitRate: 3.5, insuranceRate: 2.5, balloonPayment: 40, commissionRate: 1.0, hasSpecialOffer: false, specialOfferFirstPercent: 50, specialOfferSecondPercent: 50, specialOfferYears: 0 }
];

// Default car settings
const defaultCars = {    'Camry': [
        { name: 'E', price: 109825 },
        { name: 'LE', price: 121555 },
        { name: 'Grande', price: 145475 },
        { name: 'E HEV', price: 111090 },
        { name: 'E PLUS HEV', price: 116035 },
        { name: 'LE HEV', price: 124545 },
        { name: 'LUMIERE HEV', price: 153985 }
    ],    'Corolla': [
        { name: '1.5L XLI', price: 79350 },
        { name: '1.5L XLI EXCUTIVE', price: 83030 },
        { name: '1.8L XLI HYBRID', price: 88780 },
        { name: '1.8L XLI EXECUTIVE HYBRID MR', price: 98555 }
    ],
    'Raize': [
        { name: 'XLE', price: 67045 },
        { name: 'LIMITED', price: 73715 }
    ],
    'Urban Cruiser': [
        { name: 'GL', price: 82915 },
        { name: 'GLX', price: 92115 }
    ],
    'Veloz': [
        { name: 'GLX', price: 81995 }
    ],
    'Corolla Cross': [
        { name: 'LE HEV', price: 103845 },
        { name: 'XLE HEV', price: 113505 },
        { name: 'LIMITED HEV', price: 129260 },
        { name: 'LIMITED PLUS HEV', price: 130410 }
    ],    'RAV4': [
        { name: 'LE 4X2', price: 106662.5 },
        { name: 'LE 4X4', price: 112642.5 },
        { name: 'XLE 4X4', price: 129317.5 },
        { name: 'LE 4X2 HEV', price: 111377.5 },
        { name: 'LE 4X4 HEV', price: 117357.5 },
        { name: 'XLE 4X4 HEV', price: 138862.5 },
        { name: 'XSE 4X4 HEV', price: 161977.5 },
        { name: 'LTD 4X4 HEV', price: 165542.5 }
    ],
    'Highlander': [
        { name: 'LE HEV 4X2', price: 151455 },
        { name: 'LE HEV 4X4', price: 157780 },
        { name: 'GLE HEV 4X4', price: 168360 },
        { name: 'GLE HEV 4X4 Black Edition', price: 172845 },
        { name: 'HEV 4X4 LTD', price: 207460 }
    ],    'Innova': [
        { name: 'GL', price: 127765 },
        { name: 'GL HEV', price: 137425 },
        { name: 'VIP7 HEV', price: 145475 }
    ],    'Land Cruiser': [
        { name: 'GXR1', price: 263407.5 },
        { name: 'GXR2', price: 281347.5 },
        { name: 'GXR3', price: 310557.5 },
        { name: 'GXR4', price: 322632.5 },
        { name: 'VX', price: 387032.5 },
        { name: 'VX-R', price: 423947.5 }
    ],    'Prado': [
        { name: 'TX-2', price: 199582.5 },
        { name: 'TXL-1', price: 208150 },
        { name: 'TXL-3', price: 238107.5 },
        { name: 'ADV-2', price: 279622.5 },
        { name: 'ADV-2 2T', price: 273815 },
        { name: 'VXL-3', price: 288305 },
        { name: 'TX-2 DSL', price: 201250 },
        { name: 'TXL-2 DSL', price: 224250 },
        { name: 'ADV-1 DSL', price: 249550 }
    ],
    'Fortuner': [
        { name: 'GX2 4X2', price: 123855 },
        { name: 'GX2 4X4', price: 134665 },
        { name: 'GX2 4X4 DSL', price: 147085 },
        { name: 'VX1 4X4', price: 158010 },
        { name: 'VX3-S 4X4', price: 182160 }
    ],    'Land Cruiser Hardtop': [
        { name: 'DX - 5 Doors 4x4 MT', price: 158240 },
        { name: 'DX - 5 Doors 4x4 AT', price: 163070 },
        { name: 'DLX3 - 5 Doors 4x4 AT', price: 179170 },
        { name: 'S-DLX - 5 Doors 4x4 AT', price: 191360 },
        { name: 'DLX2 DSL - 5 Doors 4x4 AT', price: 185035 },
        { name: 'S-DLX DSL - 5 Doors 4x4 AT', price: 201192.5 }
    ],    'Land Cruiser Pickup': [
        { name: 'S-DLX - SC 4x4 AT', price: 189520 },
        { name: 'S-DLX - DC 4x4 AT', price: 201710 },
        { name: 'DX DSL - SC 4x4 AT', price: 168705 },
        { name: 'DLX2 DSL - SC 4x4 AT', price: 179802.5 },
        { name: 'S-DLX DSL - SC 4x4 AT', price: 195787.5 },
        { name: 'DX DSL - SC 4x4 MT', price: 165025 },
        { name: 'DLX3 DSL - SC 4x4 MT', price: 176180 }
    ],    'Hilux Double Cab': [
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
        { name: 'SGLX 2.8L DSL 4X4 AT', price: 175087.5 }
    ],    'Hilux Single Cab': [
        { name: 'DECKLESS 2.4L DSL 4X2 MT', price: 88090 },
        { name: 'GLX 2.7L 4X2 MT', price: 99877.5 },
        { name: 'GLX 2.7L 4X4 MT', price: 113907.5 },
        { name: 'GL 2.4L DSL 4X2 MT', price: 99992.5 },
        { name: 'GL 2.8L DSL 4X2 MT', price: 104362.5 },
        { name: 'GLX 2.4L DSL 4X4 MT', price: 120692.5 },
        { name: 'GLX 2.8L DSL 4X4 MT', price: 128972.5 },
        { name: 'GLX 2.8L DSL 4X4 AT', price: 134607.5 }
    ],
    'Hiace Van': [
        { name: 'VAN STD GAS MT', price: 122360 },
        { name: 'VAN STD DSL MT', price: 131215 },
        { name: 'VAN HIGH ROOF GAS MT', price: 139207.5 },
        { name: 'VAN STD DSL AT', price: 138115 },
        { name: 'VAN HIGH ROOF DSL MT', price: 149557.5 },
        { name: 'VAN HIGH ROOF DSL AT', price: 157032.5 }
    ],
    'Hiace Bus': [
        { name: 'BUS GASOLINE MT', price: 156630 },
        { name: 'BUS DIESEL MT', price: 166060 },
        { name: 'BUS DIESEL AT', price: 170890 }
    ],
    'Lite Ace': [
        { name: 'Gasoline MT', price: 69575 },
        { name: 'Gasoline AT', price: 72565 }
    ],    'Yaris': [
        { name: 'Y', price: 66987.5 },
        { name: 'Y LIMITED', price: 66700 },
        { name: 'Y PLUS', price: 69690 },
        { name: 'YX', price: 75670 }
    ],    'Crown': [
        { name: 'Prestige', price: 158355 },
        { name: 'Premium', price: 170315 },
        { name: 'Majesta', price: 206195 }
    ],
    'GR86': [
        { name: 'GR86 AT', price: 144785 },
        { name: 'GR86 RS MT', price: 144785 }
    ],
    'Supra': [
        { name: 'Track edition MT', price: 276000 },
        { name: 'Track edition AT', price: 276000 }
    ]
};

// Initialize data file if it doesn't exist
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ banks: defaultBanks, cars: defaultCars }, null, 2));
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
    const { password } = req.body;
    if (password === BACKEND_PASSWORD) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized: Invalid password' });
    }
}

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

// Get discount codes
app.get('/api/codes', (req, res) => {
    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        res.json({ codes: data.codes || [] });
    } catch (error) {
        console.error('Error reading codes data:', error);
        res.json({ codes: [] });
    }
});

// Update discount codes (admin only - no password required for shared updates)
app.post('/api/codes', (req, res) => {
    const { codes } = req.body;
    
    if (!Array.isArray(codes)) {
        return res.status(400).json({ error: 'Codes must be an array' });
    }
    
    try {
        const existingData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        const data = { ...existingData, codes };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        
        // Broadcast update to all connected clients
        broadcastUpdate();
        
        res.json({ success: true, message: 'Codes updated successfully' });
    } catch (error) {
        console.error('Error saving codes data:', error);
        res.status(500).json({ error: 'Failed to save codes' });
    }
});

// WebSocket for real-time updates
const WebSocket = require('ws');
const wss = new WebSocket.Server({ host: '0.0.0.0', port: 3002 });

function broadcastUpdate() {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const message = JSON.stringify({ type: 'data_updated', data });
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

wss.on('connection', (ws) => {
    console.log('Client connected to WebSocket');
    
    ws.on('close', () => {
        console.log('Client disconnected from WebSocket');
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Admin server running on http://0.0.0.0:${PORT}`);
    console.log(`📡 WebSocket server running on ws://0.0.0.0:3002`);
    console.log(`🔐 Admin password: 1234`);
    console.log(`💡 Access from tablet: Use your computer's IP address (e.g., 192.168.0.186)`);
});
