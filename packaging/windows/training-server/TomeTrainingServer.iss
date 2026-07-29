#ifndef AppVersion
  #define AppVersion "0.1.15"
#endif

#ifndef PythonVersion
  #define PythonVersion "3.11.9"
#endif

#define AppName "Tome Training Server"
#define AppPublisher "Tome"
#define ServiceBinary "tome-training-manager-" + AppVersion + ".exe"
#define RepoRoot "..\..\.."

[Setup]
AppId={{B27626B9-C52E-4C90-9328-A79B06C5C358}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf64}\Tome Training Server
DefaultGroupName=Tome Training Server
DisableProgramGroupPage=yes
OutputDir={#RepoRoot}\target\release\bundle\windows-training-server
OutputBaseFilename=Tome-Training-Server-Setup-{#AppVersion}
SetupIconFile={#RepoRoot}\apps\desktop\src-tauri\icons\icon.ico
UninstallDisplayIcon={app}\tome-training-server.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=no
RestartApplications=no
SetupLogging=yes
ChangesEnvironment=no
VersionInfoVersion={#AppVersion}.0
VersionInfoCompany={#AppPublisher}
VersionInfoDescription=One-click installer for the Tome Windows AI Training Server
VersionInfoProductName={#AppName}
VersionInfoProductVersion={#AppVersion}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#RepoRoot}\target\release\tome-training-manager.exe"; DestDir: "{app}"; DestName: "{#ServiceBinary}"; Flags: ignoreversion
Source: "{#RepoRoot}\services\training-manager\workers\train.py"; DestDir: "{app}\workers"; Flags: ignoreversion
Source: "{#RepoRoot}\services\training-manager\workers\requirements.txt"; DestDir: "{app}\workers"; Flags: ignoreversion
Source: "{#RepoRoot}\scripts\windows\install-packaged-training-manager.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoRoot}\scripts\windows\uninstall-packaged-training-manager.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoRoot}\apps\desktop\src-tauri\icons\icon.ico"; DestDir: "{app}"; DestName: "tome-training-server.ico"; Flags: ignoreversion
Source: "vendor\python-{#PythonVersion}-amd64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\install-packaged-training-manager.ps1"" -InstallRoot ""{app}"" -DataRoot ""{commonappdata}\Tome\TrainingManager"" -BinaryPath ""{app}\{#ServiceBinary}"" -PythonInstaller ""{tmp}\python-{#PythonVersion}-amd64.exe"""; StatusMsg: "Installing the training runtime and verifying Ollama..."; Flags: waituntilterminated runhidden logoutput

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\uninstall-packaged-training-manager.ps1"""; Flags: waituntilterminated runhidden logoutput

[Icons]
Name: "{group}\Check server status"; Filename: "http://127.0.0.1:11435/v1/health"
Name: "{group}\Open training data folder"; Filename: "{commonappdata}\Tome\TrainingManager"
Name: "{group}\View installation log"; Filename: "{sys}\notepad.exe"; Parameters: """{commonappdata}\Tome\TrainingManager\installer.log"""
Name: "{group}\Uninstall Tome Training Server"; Filename: "{uninstallexe}"

[Code]
procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpReady then
  begin
    WizardForm.ReadyMemo.Lines.Add('');
    WizardForm.ReadyMemo.Lines.Add(
      'Setup will install a private Python runtime, training dependencies, the Windows service, and a LocalSubnet firewall rule for TCP 11435.'
    );
    WizardForm.ReadyMemo.Lines.Add(
      'Ollama must already be installed and running. The dependency step requires an internet connection and can take several minutes.'
    );
  end;
end;
