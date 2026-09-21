# Deployment Guide - Toyota Lease Calculator

This guide will help you deploy your app to the cloud so it's accessible from your tablet 24/7, even when your computer is off.

## Option 1: Railway (Recommended - Easy & Free)

Railway is the easiest option with a generous free tier.

### Steps:

1. **Create Railway Account**
   - Go to https://railway.app
   - Sign up with GitHub

2. **Deploy Your App**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Connect your GitHub account
   - Select this repository
   - Railway will automatically detect Node.js and deploy

3. **Get Your URL**
   - After deployment, Railway will provide a URL like: `https://your-app-name.railway.app`
   - Your app will be accessible at this URL from anywhere!

4. **Access from Tablet**
   - Simply open the Railway URL in your tablet's browser
   - The app will work exactly the same!

## Option 2: Render (Free Tier Available)

Render also offers free hosting with some limitations.

### Steps:

1. **Create Render Account**
   - Go to https://render.com
   - Sign up with GitHub

2. **Create New Web Service**
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Settings:
     - **Name**: toyota-lease-calculator
     - **Environment**: Node
     - **Build Command**: `npm install`
     - **Start Command**: `npm start`
     - **Plan**: Free

3. **Deploy**
   - Click "Create Web Service"
   - Render will deploy your app
   - You'll get a URL like: `https://your-app-name.onrender.com`

4. **Access from Tablet**
   - Use the Render URL in your tablet browser

## Option 3: Fly.io (Free Tier)

Fly.io is another good option for persistent hosting.

### Steps:

1. **Install Fly CLI**
   ```bash
   powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
   ```

2. **Login and Deploy**
   ```bash
   fly auth login
   fly launch
   fly deploy
   ```

3. **Get Your URL**
   - Fly will provide a URL like: `https://your-app-name.fly.dev`

## Important Notes:

### WebSocket Support
- **Railway**: Full WebSocket support ✅
- **Render**: WebSocket support available ✅
- **Fly.io**: Full WebSocket support ✅

### Environment Variables (if needed)
If you need to change the admin password or other settings:
- Go to your hosting platform's dashboard
- Find "Environment Variables" section
- Add any variables you need

### Data Persistence
Your `admin-data.json` file will persist between deployments on all platforms, so your bank and car settings will be saved.

### Free Tier Limitations
- **Railway**: 500 hours/month free, then pay-as-you-go
- **Render**: Free tier sleeps after 15 minutes of inactivity (takes ~30 seconds to wake up)
- **Fly.io**: Generous free tier with 3 shared VMs

## Recommendation

For best results, I recommend **Railway** because:
- ✅ Easiest setup
- ✅ No sleep mode (always running)
- ✅ Fast deployments
- ✅ Good free tier

## After Deployment

Once deployed, you can:
1. Access the app from anywhere via the cloud URL
2. Use it on your tablet without your computer being on
3. Share the URL with others if needed
4. The admin panel works the same way (password: 1234)

