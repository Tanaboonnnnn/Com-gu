!macro customInit
  ; ComGu 3.0.0 briefly shipped with an appId-derived NSIS GUID that was different from
  ; the long-lived v2.x installer identity. Remove only that known-bad side-by-side install
  ; before the compatibility GUID installer chooses its destination. The uninstaller keeps
  ; app data because deleteAppDataOnUninstall is false.
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\91a49385-f194-54ae-8bf4-449ec245a7d0" "UninstallString"
  ${If} $R0 != ""
    ExecWait '$R0 /S' $R1
  ${EndIf}
!macroend
