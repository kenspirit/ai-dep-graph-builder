@echo off
setlocal enabledelayedexpansion

REM Check if the arcadedb folder exists
if exist "arcadedb" (
    echo ArcadeDB already exists. Skipping download.
) else (
    echo Downloading ArcadeDB and extracting...

    REM Download the ArcadeDB archive using curl
    curl -L -o %TEMP%\arcadedb.tar.gz https://github.com/ArcadeData/arcadedb/releases/download/25.1.1/arcadedb-25.1.1.tar.gz

    REM Create the target directory
    md arcadedb >nul 2>&1

    REM Extract the downloaded archive using tar with strip-components
    tar -xzf %TEMP%\arcadedb.tar.gz --strip-components=1 -C arcadedb
)

REM IF JDK available
for /f "tokens=3" %%a in ('java -version 2^>^&1 ^| findstr /i "version"') do (
    set "version=%%a"
    echo Found version: %version%
    goto check_version
)

echo JDK is not installed.
exit /b 1

:check_version
REM Remove "" in version string
set "version=%version:"=%"

set majorVersion=
for /f "tokens=1 delims=." %%v in ("%version%") do (
    set "majorVersion=%%v"
)

if "!majorVersion!"=="1" (
    for /f "tokens=2 delims=._" %%v in ("%version%") do (
        set "majorVersion=%%v"
    )
)

if !majorVersion! lss 17 (
    echo JDK is lower than 17. Found version: !majorVersion!
    exit /b 1
)

:continue
REM Start the ArcadeDB server in the background and log output to a file
cd arcadedb/bin
start "" cmd /c "server.bat -Darcadedb.server.rootPassword=playwithdata -Darcadedb.server.database.path=arcadedb/databases > ../../arcadedb.log 2>&1"
cd ../..
