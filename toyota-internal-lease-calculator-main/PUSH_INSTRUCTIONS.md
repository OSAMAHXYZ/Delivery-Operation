# How to Push to GitHub

## Step 1: Create the Repository on GitHub
1. Go to https://github.com/new
2. Repository name: `toyota-internal-lease-calculator`
3. Choose public or private
4. **Don't** check "Add a README file"
5. Click "Create repository"

## Step 2: Push the Code

### Option A: Using Personal Access Token (Recommended)
1. Go to https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Name it "Lease Calculator" and check `repo` scope
4. Copy the token (you won't see it again!)

Then run:
```bash
git push -u origin main
```
When prompted:
- Username: `osamaxyz`
- Password: **paste your token here** (not your GitHub password)

### Option B: Using GitHub CLI
If you have GitHub CLI installed:
```bash
gh auth login
git push -u origin main
```

### Option C: Using SSH (if you have SSH keys set up)
First change the remote:
```bash
git remote set-url origin git@github.com:osamaxyz/toyota-internal-lease-calculator.git
git push -u origin main
```

