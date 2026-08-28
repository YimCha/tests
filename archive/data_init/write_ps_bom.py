# -*- coding: utf-8 -*-
"""以 UTF-8 with BOM 写出 PowerShell 脚本，避免 PS5.1 按 ANSI 误读中文。"""
content = '''# Extract all B/C question bank files -> data\\tmp\\BC类\\NN_dept_CLASS.txt
$ErrorActionPreference = 'Stop'
$root = 'C:\\Users\\lenovo\\Desktop\\题库'
$srcDir = Join-Path $root 'data\\raw_bank'
$outDir = Join-Path $root 'data\\tmp\\BC类'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

function Get-DeptName($folderName) {
    $d = $folderName -replace '^2026年?', ''
    $d = $d -replace '题库$', ''
    return $d
}

$idx = 0
$dirs = Get-ChildItem $srcDir -Directory | Sort-Object Name
foreach ($d in $dirs) {
    $files = Get-ChildItem $d.FullName -File | Where-Object { $_.Name -match 'B类' -or $_.Name -match 'C类' }
    foreach ($f in $files) {
        $cls = if ($f.Name -match 'B类') { 'B' } else { 'C' }
        $dept = Get-DeptName $d.Name
        $idx++
        $nn = '{0:d2}' -f $idx
        $out = Join-Path $outDir ("{0}_{1}_{2}.txt" -f $nn, $dept, $cls)
        try {
            $doc = $word.Documents.Open($f.FullName, $false, $true)
            $text = $doc.Content.Text
            $doc.Close($false)
            [System.IO.File]::WriteAllText($out, $text, (New-Object System.Text.UTF8Encoding($true)))
            Write-Output ("OK {0} => {1} chars={2}" -f $f.Name, $out, $text.Length)
        } catch {
            Write-Output ("ERR {0} => {1}" -f $f.FullName, $_.Exception.Message)
        }
    }
}
$word.Quit()
Write-Output ("TOTAL: {0}" -f $idx)
'''
with open(r'c:\Users\lenovo\Desktop\题库\src\extract_bc.ps1', 'w', encoding='utf-8-sig') as f:
    f.write(content)
print('written with BOM')
