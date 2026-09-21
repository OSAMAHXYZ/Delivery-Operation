const fs = require('fs');
const path = require('path');

const QUEUE_FILE = path.join(__dirname, 'queue-data.json');
const QUEUE_LOG_FILE = path.join(__dirname, 'queue-log.json');

console.log('Resetting queue system data...');

// Delete queue data file if it exists
if (fs.existsSync(QUEUE_FILE)) {
    fs.unlinkSync(QUEUE_FILE);
    console.log('✓ Deleted queue-data.json');
} else {
    console.log('✓ queue-data.json does not exist (will be created on server start)');
}

// Delete queue log file if it exists
if (fs.existsSync(QUEUE_LOG_FILE)) {
    fs.unlinkSync(QUEUE_LOG_FILE);
    console.log('✓ Deleted queue-log.json');
} else {
    console.log('✓ queue-log.json does not exist (will be created on server start)');
}

console.log('\n✅ All queue data has been cleared!');
console.log('The system will create fresh data files when the server starts.');
console.log('Note: admin-data.json (bank configurations) was preserved.');

