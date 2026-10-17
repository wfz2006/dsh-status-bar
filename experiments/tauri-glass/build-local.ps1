$ErrorActionPreference='Stop'
Push-Location $PSScriptRoot
try {
  # Project-local compiler override: the default w64devkit lacks libgcc_eh.
  # Use the complete existing MinGW installation without changing Cargo config.
  $env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER='D:/mingw64-ucrt/mingw64/bin/gcc.exe'
  $env:PATH='D:/mingw64-ucrt/mingw64/bin;'+$env:PATH
  cargo build --release --offline --target x86_64-pc-windows-gnu @args
  if ($LASTEXITCODE -ne 0) { throw "Native comparison build failed ($LASTEXITCODE)" }
} finally { Pop-Location }
