# PowerShell script to push to GitHub with token
# Usage: Replace YOUR_TOKEN_HERE with your actual GitHub Personal Access Token

$token = Read-Host "Enter your GitHub Personal Access Token" -AsSecureString
$tokenPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($token))

$remoteUrl = "https://${tokenPlain}@github.com/OSAMAHXYZ/toyota-internal-lease-calculator.git"
git remote set-url origin $remoteUrl
git push -u origin main

# Clean up token from URL after push
git remote set-url origin https://github.com/OSAMAHXYZ/toyota-internal-lease-calculator.git

Write-Host "Push completed successfully!"

