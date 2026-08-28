$files = Get-ChildItem 'C:\Users\lenovo\Desktop\题库\2026年运营管理部题库' -File
foreach ($f in $files) {
    $m1 = $f.Name -match 'B\u7c7b'
    $m2 = $f.Name -match '[BC]\u7c7b'
    Write-Output ("{0} | matchB={1} | matchBC={2}" -f $f.Name, $m1, $m2)
}
