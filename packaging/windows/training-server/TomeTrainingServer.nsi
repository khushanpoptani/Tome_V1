Unicode True

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!ifndef APP_VERSION
  !define APP_VERSION "0.1.20"
!endif

!ifndef PYTHON_VERSION
  !define PYTHON_VERSION "3.11.9"
!endif

!ifndef REPO_ROOT
  !error "REPO_ROOT must point to the Tome repository."
!endif

!ifndef SERVICE_BINARY
  !error "SERVICE_BINARY must point to the compiled Windows service executable."
!endif

!ifndef PYTHON_INSTALLER
  !error "PYTHON_INSTALLER must point to the pinned Windows Python installer."
!endif

!ifndef OUTPUT_FILE
  !define OUTPUT_FILE "${REPO_ROOT}/target/release/bundle/windows-training-server/Tome-Training-Server-Setup-${APP_VERSION}.exe"
!endif

!define APP_NAME "Tome Training Server"
!define APP_PUBLISHER "Tome"
!define APP_REGISTRY_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\TomeTrainingServer"
!define SERVICE_FILENAME "tome-training-manager-${APP_VERSION}.exe"

Name "${APP_NAME}"
OutFile "${OUTPUT_FILE}"
InstallDir "$PROGRAMFILES64\Tome Training Server"
InstallDirRegKey HKLM "${APP_REGISTRY_KEY}" "InstallLocation"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
BrandingText "Tome"
ShowInstDetails show
ShowUninstDetails show
ManifestDPIAware true
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey /LANG=1033 "CompanyName" "${APP_PUBLISHER}"
VIAddVersionKey /LANG=1033 "FileDescription" "One-click installer for the Tome Windows AI Training Server"
VIAddVersionKey /LANG=1033 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Copyright Tome"
VIAddVersionKey /LANG=1033 "ProductName" "${APP_NAME}"
VIAddVersionKey /LANG=1033 "ProductVersion" "${APP_VERSION}"

!define MUI_ABORTWARNING
!define MUI_ICON "${REPO_ROOT}/apps/desktop/src-tauri/icons/icon.ico"
!define MUI_UNICON "${REPO_ROOT}/apps/desktop/src-tauri/icons/icon.ico"
!define MUI_FINISHPAGE_NOAUTOCLOSE
!define MUI_FINISHPAGE_TEXT "Tome Training Server is installed and running. In Tome on your Mac, add this Windows machine as a Training Manager using port 11435."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

Section "Tome Training Server" SecMain
  SetShellVarContext all
  SetRegView 64

  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP|MB_OK "Tome Training Server requires 64-bit Windows."
    Abort
  ${EndIf}

  SetOutPath "$INSTDIR"
  File /oname=${SERVICE_FILENAME} "${SERVICE_BINARY}"
  File "${REPO_ROOT}/scripts/windows/install-packaged-training-manager.ps1"
  File "${REPO_ROOT}/scripts/windows/uninstall-packaged-training-manager.ps1"
  File /oname=tome-training-server.ico "${REPO_ROOT}/apps/desktop/src-tauri/icons/icon.ico"

  SetOutPath "$INSTDIR\workers"
  File "${REPO_ROOT}/services/training-manager/workers/train.py"
  File "${REPO_ROOT}/services/training-manager/workers/requirements.txt"

  SetOutPath "$PLUGINSDIR"
  File /oname=python-${PYTHON_VERSION}-amd64.exe "${PYTHON_INSTALLER}"

  DetailPrint "Installing the private Python runtime and model-training dependencies."
  DetailPrint "This can take several minutes on the first installation."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\install-packaged-training-manager.ps1" -InstallRoot "$INSTDIR" -DataRoot "$APPDATA\Tome\TrainingManager" -BinaryPath "$INSTDIR\${SERVICE_FILENAME}" -PythonInstaller "$PLUGINSDIR\python-${PYTHON_VERSION}-amd64.exe"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "Tome Training Server setup failed.$\r$\n$\r$\nReview C:\ProgramData\Tome\TrainingManager\installer.log for the exact error, then run this installer again."
    Abort
  ${EndIf}

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  WriteRegStr HKLM "${APP_REGISTRY_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKLM "${APP_REGISTRY_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKLM "${APP_REGISTRY_KEY}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKLM "${APP_REGISTRY_KEY}" "DisplayIcon" "$INSTDIR\tome-training-server.ico"
  WriteRegStr HKLM "${APP_REGISTRY_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${APP_REGISTRY_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKLM "${APP_REGISTRY_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${APP_REGISTRY_KEY}" "NoRepair" 1

  CreateDirectory "$SMPROGRAMS\Tome Training Server"
  CreateShortCut "$SMPROGRAMS\Tome Training Server\Check server status.lnk" "$WINDIR\explorer.exe" "http://127.0.0.1:11435/v1/health" "$INSTDIR\tome-training-server.ico"
  CreateShortCut "$SMPROGRAMS\Tome Training Server\Open training data folder.lnk" "$WINDIR\explorer.exe" '"$APPDATA\Tome\TrainingManager"' "$INSTDIR\tome-training-server.ico"
  CreateShortCut "$SMPROGRAMS\Tome Training Server\View installation log.lnk" "$SYSDIR\notepad.exe" '"$APPDATA\Tome\TrainingManager\installer.log"' "$INSTDIR\tome-training-server.ico"
  CreateShortCut "$SMPROGRAMS\Tome Training Server\Uninstall Tome Training Server.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  SetShellVarContext all
  SetRegView 64

  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\uninstall-packaged-training-manager.ps1"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "The Windows service could not be fully removed. Installation files will still be removed; training data remains in C:\ProgramData\Tome\TrainingManager."
  ${EndIf}

  DeleteRegKey HKLM "${APP_REGISTRY_KEY}"
  RMDir /r "$SMPROGRAMS\Tome Training Server"
  RMDir /r "$INSTDIR"
SectionEnd
