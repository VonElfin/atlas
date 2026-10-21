; Instalador do Atlas (Inno Setup 6). Compile com: npm run installer
; A versão vem de package.json via /DAppVersion=... (scripts/build-installer.mjs).

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#define AppName "Atlas"
#define AppExe "atlas.exe"
#define WebView2Guid "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

[Setup]
; GUID fixo: é ele que faz uma versão nova atualizar a anterior em vez de instalar ao lado.
AppId={{6B1F2C0E-3D7A-4E58-9A41-7C5A2E8D1B90}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Atlas
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; Instalação por usuário, sem pedir administrador. Não oferecer a opção "para todos":
; o app grava as configurações em uma pasta .storage dentro da pasta de instalação,
; que não seria gravável em Program Files.
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=..\release
OutputBaseFilename=Atlas-Setup-{#AppVersion}
SetupIconFile=atlas.ico
UninstallDisplayIcon={app}\atlas.ico
WizardStyle=modern
Compression=lzma2/ultra
SolidCompression=yes
LicenseFile=LICENSES.txt
CloseApplications=yes
VersionInfoVersion={#AppVersion}
VersionInfoDescription=Instalador do {#AppName}

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
brazilianportuguese.WebView2Download=Baixando o componente WebView2 da Microsoft (necessário para exibir o mapa)...
brazilianportuguese.WebView2Fail=Não foi possível baixar o componente WebView2.%nSem ele o Atlas não abre. Você pode instalá-lo depois em https://developer.microsoft.com/microsoft-edge/webview2%n%nContinuar a instalação mesmo assim?
brazilianportuguese.WebView2Installing=Instalando o componente WebView2...
brazilianportuguese.WebView2Missing=O WebView2 não foi instalado. Instale-o em https://developer.microsoft.com/microsoft-edge/webview2 para o Atlas abrir.
brazilianportuguese.LaunchAtlas=Abrir o Atlas agora
english.WebView2Download=Downloading Microsoft WebView2 component (needed to show the map)...
english.WebView2Fail=Could not download the WebView2 component.%nAtlas will not start without it. You can install it later from https://developer.microsoft.com/microsoft-edge/webview2%n%nContinue anyway?
english.WebView2Installing=Installing the WebView2 component...
english.WebView2Missing=WebView2 was not installed. Install it from https://developer.microsoft.com/microsoft-edge/webview2 for Atlas to start.
english.LaunchAtlas=Launch Atlas now

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\dist\atlas\atlas-win_x64.exe"; DestDir: "{app}"; DestName: "{#AppExe}"; Flags: ignoreversion
Source: "atlas.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "LICENSES.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; WorkingDir importa: o Neutralino grava .storage (configurações) no diretório de trabalho.
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; IconFilename: "{app}\atlas.ico"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; IconFilename: "{app}\atlas.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; Description: "{cm:LaunchAtlas}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\.storage"
; Dados do WebView2 (cache de tiles etc.): o Neutralino usa %APPDATA%\<nome do exe>.
Type: filesandordirs; Name: "{userappdata}\atlas.exe"

[Code]
var
  DownloadPage: TDownloadWizardPage;

function WebView2Installed(): Boolean;
var
  pv: String;
begin
  Result :=
    (RegQueryStringValue(HKLM32, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{#WebView2Guid}', 'pv', pv) and (pv <> '') and (pv <> '0.0.0.0')) or
    (RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{#WebView2Guid}', 'pv', pv) and (pv <> '') and (pv <> '0.0.0.0'));
end;

procedure InitializeWizard();
begin
  DownloadPage := CreateDownloadPage(SetupMessage(msgWizardPreparing), CustomMessage('WebView2Download'), nil);
end;

// Windows 11 e Windows 10 atualizado já trazem o WebView2. Quando falta, baixa o
// instalador oficial da Microsoft antes de copiar os arquivos.
function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = wpReady) and not WebView2Installed() then
  begin
    DownloadPage.Clear;
    DownloadPage.Add('https://go.microsoft.com/fwlink/p/?LinkId=2124703', 'MicrosoftEdgeWebview2Setup.exe', '');
    DownloadPage.Show;
    try
      try
        DownloadPage.Download;
      except
        if DownloadPage.AbortedByUser then
          Result := False
        else
          Result := SuppressibleMsgBox(CustomMessage('WebView2Fail'), mbConfirmation, MB_YESNO, IDYES) = IDYES;
      end;
    finally
      DownloadPage.Hide;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  Bootstrapper: String;
begin
  if CurStep = ssPostInstall then
  begin
    Bootstrapper := ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe');
    if FileExists(Bootstrapper) and not WebView2Installed() then
    begin
      WizardForm.StatusLabel.Caption := CustomMessage('WebView2Installing');
      // O instalador da Microsoft pede elevação (UAC) sozinho.
      Exec(Bootstrapper, '/silent /install', '', SW_SHOW, ewWaitUntilTerminated, ResultCode);
      if not WebView2Installed() then
        SuppressibleMsgBox(CustomMessage('WebView2Missing'), mbError, MB_OK, IDOK);
    end;
  end;
end;
