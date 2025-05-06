import net from 'net';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc';

// Define the host and port where the JDT Language Server is running
const host = '127.0.0.1';
const port = 5036;
const maxRetries = 5;
const retryDelay = 2000; // 2 seconds

async function connectWithRetry(retries = 0) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      console.log('Connected to JDT Language Server');
      resolve(socket);
    });

    socket.on('error', (err) => {
      console.error(`Connection failed: ${err.message}`);
      if (retries < maxRetries) {
        console.log(`Retrying connection (${retries + 1}/${maxRetries})...`);
        setTimeout(() => resolve(connectWithRetry(retries + 1)), retryDelay);
      } else {
        reject(new Error('Max retries reached. Unable to connect.'));
      }
    });
  });
}

let connection;

async function initializeServer(rootUri) {
  try {
    const socket = await connectWithRetry();
    connection = createMessageConnection(
      new StreamMessageReader(socket),
      new StreamMessageWriter(socket)
    );
    connection.listen();
    console.log('Connection established and listening.');
  } catch (error) {
    console.error('Failed to establish connection:', error.message);
  }
  return new Promise((resolve, reject) => {
    connection.sendRequest('initialize', {
      processId: process.pid,
      rootUri,
      capabilities: {}
    }).then((response) => {
      console.log('Server initialized');
      resolve(response);
    }).catch(reject);
  });
}

async function hover(fileUri, line, charPosition) {
  return new Promise((resolve, reject) => {
    const hoverParams = { textDocument: { uri: fileUri }, position: { line, character: charPosition } };

    connection.sendRequest('textDocument/hover', hoverParams)
      .then((hoverResponse) => {
        resolve(hoverResponse.contents.value);
      }).catch(reject);
  });
}

async function getDefinition(fileUri, line, charPosition) {
  return new Promise((resolve, reject) => {
    const definitionParams = { textDocument: { uri: fileUri }, position: { line, character: charPosition } };

    connection.sendRequest('textDocument/definition', definitionParams)
      .then((definitionResponse) => {
        resolve(definitionResponse);
      }).catch(reject);
  });
}

export {
  initializeServer,
  hover,
  getDefinition
}
