# ==========================================================================
#  auto-push.ps1 · 一键检查、构建、自检、提交并推送到 GitHub
#  --------------------------------------------------------------------------
#  这个脚本由项目根目录的「一键提交到GitHub.cmd」调用，也可以手动运行：
#    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\auto-push.ps1
#
#  它只处理 main 分支：检查数据 → 重新构建 → 跑自检 → 提交 → 拉取远端
#  → 推送。任何一步失败都会停下来，不会把坏数据推上去。
# ==========================================================================

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$Root = Split-Path -Parent $PSScriptRoot
$Branch = 'main'
$RepoUrl = 'https://github.com/2681114373zxd-prog/resource-site'
$SiteUrl = 'https://2681114373zxd-prog.github.io/resource-site/'

function Write-Step([string]$Text) {
    Write-Host ''
    Write-Host "  > $Text" -ForegroundColor Cyan
}

function Stop-WithError([string]$Text) {
    Write-Host ''
    Write-Host "  [x] $Text" -ForegroundColor Red
    Write-Host ''
    exit 1
}

Write-Host ''
Write-Host '  Xixi · 一键提交到 GitHub' -ForegroundColor White
Write-Host '  ----------------------------------------' -ForegroundColor DarkGray

Set-Location $Root

# 1. 环境检查 --------------------------------------------------------------
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Stop-WithError '没有检测到 Git。请先安装 Git for Windows：https://git-scm.com/download/win'
}

git rev-parse --is-inside-work-tree *> $null
if ($LASTEXITCODE -ne 0) {
    Stop-WithError "这个目录不是 Git 仓库：$Root"
}

$CurrentBranch = (git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or -not $CurrentBranch) {
    Stop-WithError '读取当前 Git 分支失败。'
}
if ($CurrentBranch -ne $Branch) {
    Stop-WithError "当前在 $CurrentBranch 分支。这个脚本只提交 $Branch 分支，请先执行 git switch $Branch 再运行。"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Stop-WithError '没有检测到 Node.js。请先安装 LTS 版本：https://nodejs.org'
}

# 没配置过提交身份时，给一个本机的默认值，避免 commit 直接失败。
$GitName = git config user.name
if (-not $GitName) {
    git config user.name 'code-crew'
    $GitName = 'code-crew'
}
$GitEmail = git config user.email
if (-not $GitEmail) {
    git config user.email 'code-crew@local'
    $GitEmail = 'code-crew@local'
}

# 2. 检查、构建、自检 ------------------------------------------------------
Write-Step '1/5 检查 data/ 里的数据...'
node scripts/check.mjs
if ($LASTEXITCODE -ne 0) {
    Stop-WithError '数据检查没通过，已停止。请按上面的中文提示修改后再试。'
}

Write-Step '2/5 重新构建站点...'
node scripts/build.mjs
if ($LASTEXITCODE -ne 0) {
    Stop-WithError '构建失败，已停止。'
}

Write-Step '3/5 运行自检（第一次会慢一点）...'
node scripts/test.mjs
if ($LASTEXITCODE -ne 0) {
    Stop-WithError '自检没通过，已停止，没有提交任何内容。'
}

# 3. 提交 ------------------------------------------------------------------
Write-Step '4/5 提交本地改动...'
git add -A
if ($LASTEXITCODE -ne 0) {
    Stop-WithError 'git add 失败，已停止。'
}

git diff --cached --quiet
$DiffCode = $LASTEXITCODE
if ($DiffCode -gt 1) {
    Stop-WithError '检查暂存区失败，已停止。'
}

$HasChanges = ($DiffCode -eq 1)
if ($HasChanges) {
    $Message = "chore: 自动提交 $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    $MessageFile = Join-Path ([System.IO.Path]::GetTempPath()) ("resource-site-commit-" + [guid]::NewGuid().ToString('N') + '.txt')
    try {
        [System.IO.File]::WriteAllText($MessageFile, $Message + "`n", [System.Text.UTF8Encoding]::new($false))
        git commit -F $MessageFile
        if ($LASTEXITCODE -ne 0) {
            Stop-WithError 'git commit 失败，已停止。'
        }
    }
    finally {
        Remove-Item -LiteralPath $MessageFile -ErrorAction SilentlyContinue
    }
    Write-Host "  ✓ 已提交：$Message" -ForegroundColor Green
}
else {
    Write-Host '  · 没有新的文件改动，跳过提交' -ForegroundColor DarkGray
}

# 4. 同步远端，避免覆盖别人的提交 ------------------------------------------
Write-Step '5/5 检查 GitHub 上有没有新提交...'
git fetch origin $Branch
if ($LASTEXITCODE -ne 0) {
    Stop-WithError '连接 GitHub 失败。请检查网络/代理；首次使用需要在弹出的窗口登录 GitHub。'
}

$Behind = [int](git rev-list --count "HEAD..origin/$Branch")
if ($Behind -gt 0) {
    Write-Host "  · GitHub 比本地多 $Behind 个提交，先同步..." -ForegroundColor DarkGray
    git pull --rebase origin $Branch
    if ($LASTEXITCODE -ne 0) {
        git rebase --abort 2>$null
        Stop-WithError '同步失败，可能有文件冲突。请手动处理后再运行本脚本（本地提交没有丢）。'
    }
}

$Ahead = [int](git rev-list --count "origin/$Branch..HEAD")
if ($Ahead -eq 0) {
    Write-Host ''
    Write-Host '  ✓ GitHub 上已经是最新版本，不需要推送' -ForegroundColor Green
    Write-Host "  仓库：$RepoUrl"
    Write-Host "  线上：$SiteUrl"
    Write-Host ''
    exit 0
}

Write-Step "推送到 GitHub（$Ahead 个提交）..."
git push origin $Branch
if ($LASTEXITCODE -ne 0) {
    Stop-WithError '推送失败。首次使用请在弹出的窗口登录 GitHub，登录成功后再双击一次本脚本。'
}

Write-Host ''
Write-Host "  ✓ 已推送 $Ahead 个提交到 GitHub" -ForegroundColor Green
Write-Host '  GitHub Actions 会自动部署，通常 1～2 分钟后线上更新。' -ForegroundColor Gray
Write-Host "  仓库：$RepoUrl"
Write-Host "  线上：$SiteUrl"
Write-Host ''
exit 0
