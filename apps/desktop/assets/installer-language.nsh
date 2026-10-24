; Resolve the name at install time, after the user chooses a language. The
; builder uses SHORTCUT_NAME for desktop/start-menu links and its uninstall
; registry record, so keep all three on the same localized value.
LangString LuminaShortcutName 2052 "光匣 Lumina"
LangString LuminaShortcutName 1033 "Lumina"
LangString LuminaShortcutName 1041 "Lumina"
!ifdef SHORTCUT_NAME
  !undef SHORTCUT_NAME
!endif
!define SHORTCUT_NAME "$(LuminaShortcutName)"

; Installer selection seeds only the first launch. Existing user choices win.
!macro customInstall
  StrCpy $R0 "zh-CN"
  ${If} $LANGUAGE == 1033
    StrCpy $R0 "en"
  ${ElseIf} $LANGUAGE == 1041
    StrCpy $R0 "ja"
  ${EndIf}
  FileOpen $R1 "$INSTDIR\installation-language.json" w
  FileWrite $R1 '{$\"language$\":$\"$R0$\"}'
  FileClose $R1
!macroend
