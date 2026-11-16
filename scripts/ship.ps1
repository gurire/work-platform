# Ships one branch: push, open a pull request, wait for checks, merge, update main.
# Usage:  pnpm ship <branch-name>
# It stops and asks before merging, so you still review what is going in.
param(
  [Parameter(Mandatory = $true)][string]$Branch
)

function Step([string]$Text) { Write-Host "`n== $Text" -ForegroundColor Cyan }
function Fail([string]$Text) { Write-Host "`nSTOPPED: $Text" -ForegroundColor Red; exit 1 }

if ($Branch -eq 'main') { Fail 'Give a feature branch, not main.' }

Step "Pushing $Branch"
git push -u origin $Branch
if ($LASTEXITCODE -ne 0) { Fail 'Push failed. If it says permission denied, run: gh auth switch -u gurire' }

Step 'Opening the pull request'
$existing = gh pr list --head $Branch --state open --json number --jq 'length'
if ($LASTEXITCODE -ne 0) { Fail 'Could not ask GitHub about pull requests.' }
if ($existing -eq '0') {
  $title = git log -1 --format=%s $Branch
  $body = (git log -1 --format=%b $Branch) -join "`n"
  if ([string]::IsNullOrWhiteSpace($body)) { $body = $title }
  gh pr create --base main --head $Branch --title $title --body $body
  if ($LASTEXITCODE -ne 0) { Fail 'Could not create the pull request.' }
} else {
  Write-Host 'A pull request for this branch is already open.'
}

Step 'Files in this pull request'
gh pr diff $Branch --name-only
Write-Host ''
gh pr view $Branch --json url --jq '.url'
$answer = Read-Host "`nMerge this once the checks pass? (y/n)"
if ($answer -ne 'y') { Fail 'Not merged. The pull request stays open on GitHub.' }

Step 'Waiting for GitHub checks'
$started = $false
for ($try = 1; $try -le 12; $try++) {
  gh pr checks $Branch --watch
  if ($LASTEXITCODE -eq 0) { $started = $true; break }
  $count = gh pr checks $Branch --json name --jq 'length' 2>$null
  if ($count -and $count -ne '0') { Fail 'A check failed. Open the link above to see which one.' }
  Start-Sleep -Seconds 10
}
if (-not $started) { Fail 'Checks did not start. Look at the pull request on GitHub.' }

Step 'Merging'
gh pr merge $Branch --merge
if ($LASTEXITCODE -ne 0) { Fail 'Merge failed.' }

Step 'Updating your local main'
git checkout main
git pull
if ($LASTEXITCODE -ne 0) { Fail 'Could not update main.' }
pnpm install
Write-Host "`nDone: $Branch is merged and main is up to date." -ForegroundColor Green
