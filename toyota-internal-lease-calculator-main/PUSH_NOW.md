# Push Your Code to GitHub

## Method 1: Using PowerShell Script (Recommended)

1. Open PowerShell in this folder
2. Run: `.\push-to-github.ps1`
3. When prompted, paste your GitHub Personal Access Token
4. The code will be pushed automatically

## Method 2: Manual Command

Run this command in PowerShell (replace `YOUR_TOKEN_HERE` with your actual token):

```powershell
git remote set-url origin https://YOUR_TOKEN_HERE@github.com/OSAMAHXYZ/toyota-internal-lease-calculator.git
git push -u origin main
git remote set-url origin https://github.com/OSAMAHXYZ/toyota-internal-lease-calculator.git
```

## Method 3: Using Git Credential Manager

Run these commands, then push:

```powershell
git config --global credential.helper manager-core
git push -u origin main
```

When prompted:
- Username: `OSAMAHXYZ`
- Password: **paste your Personal Access Token** (not your GitHub password)

## After Pushing

Your code will be available at: https://github.com/OSAMAHXYZ/toyota-internal-lease-calculator

Then you can deploy to Railway or Render using this repository!

