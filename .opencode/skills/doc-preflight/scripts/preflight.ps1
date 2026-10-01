#Requires -Version 7.0
<#
.SYNOPSIS
  Mechanical consistency gate for a set of engineering .md documents.
.DESCRIPTION
  Read-only. Never writes. Reports ERROR (blocks work) and WARN (note it).
  Exit 0 = gate passed, 1 = gate failed.
#>
[CmdletBinding()]
param(
  [string]$Root = '.',
  [string[]]$Docs,
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$findings = [System.Collections.Generic.List[object]]::new()

function Add-Finding {
  param([string]$Severity, [string]$Check, [string]$File, [int]$Line, [string]$Message)
  $findings.Add([pscustomobject]@{
    Severity = $Severity; Check = $Check; File = $File; Line = $Line; Message = $Message
  })
}

# ---------- discover the doc set ----------
$exclude = '^(README|CHANGELOG|CONTRIBUTING|LICENSE|AGENTS|CLAUDE|NOTICE|SECURITY)(\.|$)'
if (-not $Docs) {
  if (-not (Test-Path -LiteralPath $Root)) {
    Write-Host "preflight: root '$Root' does not exist" -ForegroundColor Yellow
    exit 1
  }
  $Docs = Get-ChildItem -Path $Root -Filter '*.md' -File |
    Where-Object { $_.BaseName -notmatch $exclude } |
    Select-Object -ExpandProperty FullName
}
if (-not $Docs -or $Docs.Count -eq 0) {
  Write-Host 'preflight: no .md documents found' -ForegroundColor Yellow
  exit 0
}

# read every doc once. Resolve to a full path: a bare 'spec.md' has no directory
# component, which makes Split-Path -Parent return '' and breaks link checking.
$docSet = @{}
foreach ($p in $Docs) {
  if (-not (Test-Path -LiteralPath $p)) { Add-Finding 'ERROR' 'discovery' $p 0 'file not found'; continue }
  $full = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $p).Path)
  $text = [System.IO.File]::ReadAllText($full)
  $docSet[(Split-Path $full -Leaf)] = [pscustomobject]@{
    Path = $full; Stem = [System.IO.Path]::GetFileNameWithoutExtension($full)
    Text = $text; Lines = $text -split "`r?`n"
  }
}

# Nothing readable at all. Bail out before catalogue detection, which would
# index the per-doc tables with a null key and throw.
if ($docSet.Count -eq 0) {
  if (-not $Quiet) {
    foreach ($f in $findings) {
      Write-Host ("[ERROR] {0,-8} {1}" -f $f.Check, $f.File) -ForegroundColor Red -NoNewline
      Write-Host ("`n         {0}" -f $f.Message)
    }
    Write-Host "`n GATE FAILED - no documents could be read." -ForegroundColor Red
  }
  exit 1
}

# ---------- C1 encoding ----------
foreach ($k in $docSet.Keys) {
  $d = $docSet[$k]
  $bytes = [System.IO.File]::ReadAllBytes($d.Path)
  $strict = [System.Text.UTF8Encoding]::new($false, $true)
  try   { [void]$strict.GetString($bytes) }
  catch { Add-Finding 'ERROR' 'encoding' $k 0 "not valid UTF-8: $($_.Exception.Message)" }
  $bad = ([regex]::Matches($d.Text, [char]0xFFFD)).Count
  if ($bad -gt 0) { Add-Finding 'ERROR' 'encoding' $k 0 "$bad replacement char(s) (U+FFFD) - mojibake or a bad edit" }
}

# ---------- C2 code fences ----------
foreach ($k in $docSet.Keys) {
  $n = (Select-String -Path $docSet[$k].Path -Pattern '^```' -AllMatches).Count
  if ($n % 2 -ne 0) { Add-Finding 'ERROR' 'fences' $k 0 "$n fences - odd count, an unclosed code block" }
}

# ---------- C3 heading numbering ----------
$headings = @{}   # file -> ordered list of numbers
foreach ($k in $docSet.Keys) {
  $nums = [System.Collections.Generic.List[object]]::new()
  for ($i = 0; $i -lt $docSet[$k].Lines.Count; $i++) {
    if ($docSet[$k].Lines[$i] -match '^(#{2,3})\s+(\d+(?:\.\d+)*[A-Z]?)[.\s]') {
      $nums.Add([pscustomobject]@{ Num = $Matches[2]; Line = $i + 1 })
    }
  }
  $headings[$k] = $nums
  $dupes = $nums | Group-Object Num | Where-Object Count -gt 1
  foreach ($g in $dupes) {
    $at = ($g.Group | ForEach-Object Line) -join ', '
    Add-Finding 'ERROR' 'headings' $k $g.Group[0].Line "duplicate section number '$($g.Name)' (also at line(s) $at)"
  }
}

# ---------- C4 cross-document section references ----------
$alias = @{}   # lowercase stem -> file key
foreach ($k in $docSet.Keys) { $alias[$docSet[$k].Stem.ToLower()] = $k }
foreach ($stem in $docSet.Keys.Keys) { $alias[$stem.ToLower()] = $stem }

$validNums = @{}   # file key -> set of top-level section numbers
foreach ($k in $docSet.Keys) {
  $set = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($h in $headings[$k]) { [void]$set.Add($h.Num.Split('.')[0]) }
  $validNums[$k] = $set
}

$refRe = [regex]'\b([a-z0-9_]+)\s*§\s*(\d+[A-Z]?)\b'
foreach ($k in $docSet.Keys) {
  for ($i = 0; $i -lt $docSet[$k].Lines.Count; $i++) {
    foreach ($m in $refRe.Matches($docSet[$k].Lines[$i])) {
      $target = $alias[$m.Groups[1].Value.ToLower()]
      if (-not $target) { continue }
      if ($k -eq $target) { continue }          # self-reference is fine
      $num = $m.Groups[2].Value
      if (-not $validNums[$target].Contains($num)) {
        Add-Finding 'ERROR' 'xref' $k ($i + 1) "points at $target §$num but no such section exists there"
      }
    }
  }
}

# ---------- C5 identifier namespaces ----------
# The doc that DEFINES the most identifiers (first table column / list marker) is
# the catalogue; every id used anywhere must be declared there. Also catches
# lookalike separators (en/em hyphen, nbsp) that break copy-paste and search.
#
# An identifier is 2+ hyphen-separated uppercase segments whose LAST segment
# contains a digit. That deliberately excludes bare family prefixes (RPT-PLT)
# and prose caps (P0), while keeping JOB-01, RPT-PLT-09, PLT-T7, AC-23.
$idRe = [regex]'\b[A-Z][A-Z0-9]{1,5}(?:-[A-Z0-9]{1,6}){1,3}\b'
$LOOKALIKE = '[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u00A0]'

function Test-IsId {
  param([string]$s)
  $parts = $s -split '-'
  if ($parts.Count -lt 2) { return $false }
  return ($parts[-1] -match '\d')
}
function Get-IdFamily {
  param([string]$s)
  # NOTE: do not write ($s -split '-')[0..-2] -join '-' — PowerShell binds the
  # -join to the wrong operand and yields e.g. 'JOB-01-JOB'.
  $parts = @($s -split '-')
  if ($parts.Count -le 1) { return $s }
  return [string]::Join('-', $parts[0..($parts.Count - 2)])
}

$idsByDoc = @{}; $idLines = @{}; $defCount = @{}; $defsByDoc = @{}
foreach ($k in $docSet.Keys) {
  $set = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  $first = @{}
  for ($i = 0; $i -lt $docSet[$k].Lines.Count; $i++) {
    foreach ($m in $idRe.Matches($docSet[$k].Lines[$i])) {
      if (-not (Test-IsId $m.Value)) { continue }
      [void]$set.Add($m.Value)
      if (-not $first.ContainsKey($m.Value)) { $first[$m.Value] = $i + 1 }
    }
  }
  $idsByDoc[$k] = $set; $idLines[$k] = $first

  # Count ids that look DEFINED here: first cell of a table row, or the leading
  # token of a list item. The catalogue doc is the one that defines ids, which
  # is not the same as the one that mentions the most of them (a downstream doc
  # full of typos can easily mention more unique ids than the real catalogue).
  $defs = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  for ($i = 0; $i -lt $docSet[$k].Lines.Count; $i++) {
    $line = $docSet[$k].Lines[$i]
    $tok = $null
    if ($line -match '^\s*\|(.+)$') {
      $cell = ($Matches[1] -split '\|')[0]
      if ($cell -match '\b([A-Z][A-Z0-9]{1,5}(?:-[A-Z0-9]{1,6}){1,3})\b') { $tok = $Matches[1] }
    } elseif ($line -match '^\s*(?:[-*+]\s+|\d+[.)]\s+)(\S+)') {
      if ($Matches[1] -match '\b([A-Z][A-Z0-9]{1,5}(?:-[A-Z0-9]{1,6}){1,3})\b') { $tok = $Matches[1] }
    }
    if ($tok -and (Test-IsId $tok)) { [void]$defs.Add($tok) }
  }
  $defCount[$k] = $defs.Count
  $defsByDoc[$k] = $defs
}

$bestDef = ($docSet.Keys | Sort-Object { $defCount[$_] } -Descending | Select-Object -First 1)
$catalogue = if ($defCount[$bestDef] -gt 0) { $bestDef } else { ($docSet.Keys | Sort-Object { $idsByDoc[$_].Count } -Descending | Select-Object -First 1) }
$catSet = $idsByDoc[$catalogue]
# Families are taken from ids the catalogue actually DEFINES, not ones it merely
# mentions. Otherwise a pass-by-reference like "extends AC-18" would make AC a
# "known" family and every downstream AC-23 would look undeclared - even though
# acceptance scenarios here are a numbered list with no AC-* definition table.
$catFams = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
foreach ($id in $defsByDoc[$catalogue]) { [void]$catFams.Add((Get-IdFamily $id)) }
if ($catSet.Count -gt 0) {
  foreach ($k in $docSet.Keys) {
    if ($k -eq $catalogue) { continue }
    foreach ($id in $idsByDoc[$k]) {
      # Only judge IDs whose family the catalogue knows about; a genuinely new
      # namespace is not an error.
      if (-not $catFams.Contains((Get-IdFamily $id))) { continue }
      if (-not $catSet.Contains($id)) {
        Add-Finding 'ERROR' 'ids' $k $idLines[$k][$id] "'$id' belongs to a known family but is not declared in the catalogue doc ($catalogue)"
      }
    }
  }
}
# lookalike separators inside otherwise-valid ids. The class must contain ONLY
# lookalikes (no ASCII hyphen) or every id would match.
$lookRe = [regex]("\b([A-Z][A-Z0-9]{1,5})" + $LOOKALIKE + "([A-Z0-9]{1,6}(?:" + $LOOKALIKE + "[A-Z0-9]{1,6})*)\b")
foreach ($k in $docSet.Keys) {
  for ($i = 0; $i -lt $docSet[$k].Lines.Count; $i++) {
    foreach ($m in $lookRe.Matches($docSet[$k].Lines[$i])) {
      $fixed = ($m.Value -replace $LOOKALIKE, '-')
      if ($catSet.Contains($fixed)) {
        Add-Finding 'WARN' 'ids' $k ($i + 1) "'$($m.Value)' uses a lookalike separator; canonical form is '$fixed' - will not match a search for it"
      }
    }
  }
}

# ---------- C6 stub / empty sections ----------
# A container section (## heading followed by a ### subheading) is normal. Only
# flag when the next heading is the SAME or a SHALLOWER level.
foreach ($k in $docSet.Keys) {
  $lines = $docSet[$k].Lines
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^(#{2,6})\s') {
      $level = $Matches[1].Length
      $j = $i + 1; while ($j -lt $lines.Count -and $lines[$j].Trim() -eq '') { $j++ }
      if ($j -ge $lines.Count) { break }
      if ($lines[$j] -match '^(#{2,6})\s' -and $Matches[1].Length -le $level) {
        Add-Finding 'WARN' 'stub' $k ($i + 1) "section '$($lines[$i].Trim('# '))' has no content of its own"
      }
    }
  }
}

# ---------- C7 markdown table column consistency ----------
foreach ($k in $docSet.Keys) {
  $lines = $docSet[$k].Lines
  $blockStart = -1; $counts = @(); $expected = 0
  for ($i = 0; $i -le $lines.Count; $i++) {
    $isRow = $i -lt $lines.Count -and $lines[$i].TrimStart().StartsWith('|')
    if ($isRow) {
      if ($blockStart -lt 0) { $blockStart = $i; $expected = 0 }
      $pipes = ([regex]::Matches($lines[$i], '(?<!\\)\|')).Count
      if ($expected -eq 0) { $expected = $pipes }
      elseif ($pipes -ne $expected) {
        Add-Finding 'ERROR' 'table' $k ($i + 1) "table starting line $($blockStart + 1) has $pipes pipes, expected $expected - row is malformed"
      }
    } else {
      if ($blockStart -ge 0 -and $expected -gt 0) { $blockStart = -1; $expected = 0 }
    }
  }
}

# ---------- C8 local link targets ----------
foreach ($k in $docSet.Keys) {
  $dir = Split-Path $docSet[$k].Path -Parent
  for ($i = 0; $i -lt $docSet[$k].Lines.Count; $i++) {
    foreach ($m in [regex]::Matches($docSet[$k].Lines[$i], '\]\(([^)#\s]+\.md)(?:#[^)]*)?\)')) {
      $target = Join-Path $dir $m.Groups[1].Value
      if (-not (Test-Path -LiteralPath $target)) {
        Add-Finding 'ERROR' 'links' $k ($i + 1) "link target '$($m.Groups[1].Value)' does not exist"
      }
    }
  }
}

# ---------- report ----------
$errors = @($findings | Where-Object Severity -eq 'ERROR')
$warns  = @($findings | Where-Object Severity -eq 'WARN')

if (-not $Quiet) {
  $bar = '=' * 64
  Write-Host "`n$bar" -ForegroundColor DarkGray
  Write-Host ' DOC PREFLIGHT' -ForegroundColor Cyan
  Write-Host " docs: $($docSet.Keys.Count)  catalogue: $catalogue" -ForegroundColor DarkGray
  Write-Host $bar -ForegroundColor DarkGray

  foreach ($f in ($findings | Sort-Object Severity, Check, File, Line)) {
    $loc = if ($f.Line -gt 0) { "$($f.File):$($f.Line)" } else { $f.File }
    $col = if ($f.Severity -eq 'ERROR') { 'Red' } else { 'Yellow' }
    Write-Host ("[{0}] {1,-8} {2}" -f $f.Severity, $f.Check, $loc) -ForegroundColor $col -NoNewline
    Write-Host ("`n         {0}" -f $f.Message)
  }

  if ($findings.Count -eq 0) {
    Write-Host "`n PASS - no findings." -ForegroundColor Green
  } else {
    Write-Host ("`n {0} error(s), {1} warning(s)" -f $errors.Count, $warns.Count) -ForegroundColor $(if ($errors.Count) { 'Red' } else { 'Yellow' })
    if ($errors.Count) { Write-Host ' GATE FAILED - fix before starting work.' -ForegroundColor Red }
    else { Write-Host ' GATE PASSED with warnings.' -ForegroundColor Yellow }
  }
  Write-Host ""
}

exit $(if ($errors.Count) { 1 } else { 0 })