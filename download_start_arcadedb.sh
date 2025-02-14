#!/bin/bash

# Enable extended globbing and error handling
set -e

# Check if the arcadedb folder exists
if [ -d "arcadedb" ]; then
    echo "ArcadeDB already exists. Skipping download."
else
    echo "Downloading ArcadeDB and extracting..."

    # Download the ArcadeDB archive using curl
    curl -L -o /tmp/arcadedb.tar.gz https://github.com/ArcadeData/arcadedb/releases/download/25.1.1/arcadedb-25.1.1.tar.gz

    # Create the target directory
    mkdir -p arcadedb

    # Extract the downloaded archive using tar with strip-components
    tar -xzf /tmp/arcadedb.tar.gz --strip-components=1 -C arcadedb
fi

# Check if JDK is available
if java -version >/dev/null 2>&1; then
    # Extract the version string
    version=$(java -version 2>&1 | grep -i "version" | awk -F '"' '{print $2}')
    echo "Found Java version: $version"
else
    echo "JDK is not installed."
    exit 1
fi

# Parse the major version number
majorVersion=$(echo "$version" | cut -d'.' -f1)

# Handle JDK versions below 9 (e.g., 1.8)
if [[ "$majorVersion" == "1" ]]; then
    majorVersion=$(echo "$version" | cut -d'.' -f2)
fi

# Check if the major version is less than 17
if (( majorVersion < 17 )); then
    echo "JDK version is lower than 17. Found version: $majorVersion"
    exit 1
fi

# Start the ArcadeDB server in the background and log output to a file
cd arcadedb/bin || { echo "Failed to change directory to arcadedb/bin"; exit 1; }
nohup ./server.sh \
    -Darcadedb.server.rootPassword=playwithdata \
    -Darcadedb.server.database.path=../databases \
    > ../../arcadedb.log 2>&1 &
echo "ArcadeDB server started in the background. Logs are being written to arcadedb.log"

# Return to the original directory
cd ../..
