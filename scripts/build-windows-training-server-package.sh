#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
app_version="$(sed -nE 's/^[[:space:]]*version[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' "${repo_root}/Cargo.toml" | head -1)"
python_version="3.11.9"
python_sha256="5ee42c4eee1e6b4464bb23722f90b45303f79442df63083f05322f1785f5fdde"
windows_target="x86_64-pc-windows-msvc"
service_binary="${repo_root}/target/${windows_target}/release/tome-training-manager.exe"
vendor_dir="${repo_root}/packaging/windows/training-server/vendor"
python_installer="${vendor_dir}/python-${python_version}-amd64.exe"
bundle_dir="${repo_root}/target/release/bundle/windows-training-server"
setup_exe="${bundle_dir}/Tome-Training-Server-Setup-${app_version}.exe"
delivery_dir="${bundle_dir}/Tome-Training-Server-${app_version}"
delivery_zip="${bundle_dir}/Tome-Training-Server-${app_version}-Windows-x64.zip"

for required_command in cargo cargo-xwin makensis curl shasum zip; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    echo "Missing required build command: ${required_command}" >&2
    exit 1
  fi
done

mkdir -p "${vendor_dir}" "${bundle_dir}" "${delivery_dir}"

if [[ ! -f "${python_installer}" ]]; then
  curl \
    --fail \
    --location \
    --output "${python_installer}" \
    "https://www.python.org/ftp/python/${python_version}/python-${python_version}-amd64.exe"
fi

actual_python_sha256="$(shasum -a 256 "${python_installer}" | awk '{print $1}')"
if [[ "${actual_python_sha256}" != "${python_sha256}" ]]; then
  echo "Python installer checksum mismatch." >&2
  echo "Expected: ${python_sha256}" >&2
  echo "Actual:   ${actual_python_sha256}" >&2
  exit 1
fi

(
  cd "${repo_root}"
  cargo xwin build \
    --release \
    --target "${windows_target}" \
    -p tome-training-manager
)

makensis \
  -DAPP_VERSION="${app_version}" \
  -DPYTHON_VERSION="${python_version}" \
  -DREPO_ROOT="${repo_root}" \
  -DSERVICE_BINARY="${service_binary}" \
  -DPYTHON_INSTALLER="${python_installer}" \
  -DOUTPUT_FILE="${setup_exe}" \
  "${repo_root}/packaging/windows/training-server/TomeTrainingServer.nsi"

cp "${setup_exe}" "${delivery_dir}/"

cat >"${delivery_dir}/README.txt" <<EOF
Tome Training Server ${app_version}
====================================

Windows requirements:
- 64-bit Windows 10 or 11
- Ollama installed and running
- Internet connection during the first setup
- At least 12 GB free disk space

Install:
1. Start Ollama.
2. Double-click Tome-Training-Server-Setup-${app_version}.exe.
3. Approve the Windows administrator prompt.
4. Keep the installer open while it installs the training runtime and verifies the server.
   The first setup can take several minutes because model-training dependencies are downloaded.
5. In Tome on your Mac, add and activate this Training Manager URL:
   http://192.168.1.6:11435

No Cargo, Rust, Python, PowerShell, or Inno Setup commands are required.

If Windows SmartScreen appears for this unsigned development build, select
"More info", verify that the file came from your Tome development machine,
then select "Run anyway".

Troubleshooting log:
C:\ProgramData\Tome\TrainingManager\installer.log

Uninstalling preserves datasets, jobs, models, and logs in:
C:\ProgramData\Tome\TrainingManager
EOF

(
  cd "${delivery_dir}"
  shasum -a 256 "Tome-Training-Server-Setup-${app_version}.exe" >SHA256SUMS.txt
)

rm -f "${delivery_zip}"
(
  cd "${bundle_dir}"
  zip -9 -r "$(basename "${delivery_zip}")" "$(basename "${delivery_dir}")"
)

echo "Windows package created:"
echo "${setup_exe}"
echo "${delivery_zip}"
