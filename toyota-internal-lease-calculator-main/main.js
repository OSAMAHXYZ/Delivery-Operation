const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let serverProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    icon: path.join(__dirname, 'icon.png'), // Optional: add an icon
    title: 'Toyota Lease Calculator'
  });

  // Start the admin server
  serverProcess = spawn('node', [path.join(__dirname, 'admin-server.js')], {
    cwd: __dirname,
    stdio: 'inherit'
  });

  // Start the web server
  setTimeout(() => {
    spawn('node', [path.join(__dirname, 'server.js')], {
      cwd: __dirname,
      stdio: 'inherit'
    });
  }, 3000);

  // Wait a bit for servers to start, then load the app
  setTimeout(() => {
    mainWindow.loadURL('http://localhost:8000/simple-app.html');
  }, 5000);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});






