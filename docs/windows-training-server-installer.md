# Windows Training Server installer

Tome distributes the Windows-side Training Manager as one UAC-enabled setup executable:

```text
Tome-Training-Server-Setup-<version>.exe
```

The user does not need Cargo, Rust, PowerShell commands, or a separately installed Python
runtime. Ollama must already be installed and running, and the first installation needs an
internet connection for the model-training Python packages.

## User installation

1. Start Ollama on the Windows AI server.
2. Double-click the Tome Training Server setup executable.
3. Approve the Windows administrator prompt.
4. Keep the installer open while it installs and verifies the training dependencies.
5. In Tome on macOS, add `http://<windows-lan-ip>:11435` under **Training → Dashboard**,
   then click **Test** and **Activate**.

Setup automatically:

- installs the versioned native Training Manager executable;
- installs a private Python 3.11 runtime under `C:\ProgramData\Tome\TrainingManager`;
- creates an isolated Python environment and installs the documented worker dependencies;
- preserves an existing Training Manager database and configuration during upgrades;
- registers the `TomeTrainingManager` automatic Windows service;
- configures service restart recovery;
- opens TCP `11435` only for devices on the Windows machine's local subnet;
- verifies local Ollama and the Training Manager `/v1/health` response.

Detailed installation output is saved at:

```text
C:\ProgramData\Tome\TrainingManager\installer.log
```

The Start menu contains shortcuts for the health endpoint, data directory, installer log,
and uninstaller.

Uninstalling removes the service, firewall rule, and installed application files. It
intentionally preserves datasets, jobs, logs, configuration, and the private Python
environment in `C:\ProgramData\Tome\TrainingManager`. Those records can be explicitly
removed from **Tome → Settings → Security → Database reset**.

## Producing the executable

The native setup executable must be produced on Windows. The dedicated GitHub Actions
workflow builds and uploads it on demand and for version tags.

For a local release build, install Rust and Inno Setup 6, then run:

```powershell
.\scripts\windows\build-training-server-installer.ps1
```

The build script compiles the native service, downloads the pinned official Python runtime
installer when it is not already cached, verifies its pinned SHA-256 checksum, and writes
the result to:

```text
target\release\bundle\windows-training-server
```

The Python installer is a build input only. The committed repository does not contain the
third-party executable.

Development installers are unsigned and Windows SmartScreen may request an additional
confirmation. Production distribution requires the code-signing milestone described in the
roadmap.
