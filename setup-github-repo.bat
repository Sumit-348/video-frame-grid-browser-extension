@echo off
setlocal EnableDelayedExpansion

echo ============================================
echo  Video Frame Grid - GitHub Repo Setup
echo ============================================
echo.

REM Step 1: Check git
git --version >nul 2>&1
if !errorlevel! neq 0 (
    echo [ERROR] Git is not installed or not in PATH.
    echo Download it from https://git-scm.com/downloads
    pause
    exit /b 1
)
echo [OK] Git is installed.

REM Step 2: Check gh CLI
gh --version >nul 2>&1
if !errorlevel! neq 0 (
    echo [ERROR] GitHub CLI gh is not installed.
    echo Install it from https://cli.github.com
    pause
    exit /b 1
)
echo [OK] GitHub CLI is installed.

REM Step 3: Check auth
echo.
echo Checking GitHub authentication...
gh auth status >nul 2>&1
if !errorlevel! neq 0 (
    echo You are not logged in. Starting login...
    echo.
    gh auth login
)
echo [OK] Authenticated with GitHub.

REM Step 4: Get username
echo.
for /f "usebackq tokens=*" %%a in (`gh api user --jq .login`) do set GITHUB_USER=%%a
if "!GITHUB_USER!"=="" (
    echo [ERROR] Could not get your GitHub username.
    pause
    exit /b 1
)
echo [OK] Logged in as: !GITHUB_USER!

REM Step 5: Update README
echo.
echo Updating README with your username...
powershell -Command "(Get-Content README.md) -replace 'YOUR_USERNAME', '!GITHUB_USER!' | Set-Content README.md"

REM Step 6: Init and commit
echo.
echo Initializing git repo...
git init
git add -A
git commit -m "Initial release - Video Frame Grid v1.0.0"

REM Step 7: Create repo and push
echo.
echo Creating GitHub repo...
gh repo create video-frame-grid-browser-extension --public --source=. --push --description "Browser extension that generates a visual contact sheet from any video. Preview entire videos at a glance, click any frame to seek."

if !errorlevel! neq 0 (
    echo.
    echo [ERROR] Could not create repo. It may already exist.
    echo Run these manually:
    echo   git remote add origin https://github.com/!GITHUB_USER!/video-frame-grid-browser-extension.git
    echo   git branch -M main
    echo   git push -u origin main
    pause
    exit /b 1
)

REM Step 8: Add topics
echo.
echo Adding topics for discoverability...
gh repo edit --add-topic "browser-extension,chrome-extension,firefox-extension,video,contact-sheet,frame-grid,youtube"

echo.
echo ============================================
echo  DONE! Your repo is live at:
echo  https://github.com/!GITHUB_USER!/video-frame-grid-browser-extension
echo ============================================
echo.
pause
