import net from 'net';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc';

// Define the host and port where the JDT Language Server is running
const host = '127.0.0.1';
const port = 5036;

// Create a socket connection to the JDT Language Server
const socket = net.createConnection({ host, port }, () => {
  console.log('Connected to JDT Language Server');
});

// Create a message connection using the socket streams
const connection = createMessageConnection(
  new StreamMessageReader(socket),
  new StreamMessageWriter(socket)
);

// Listen for messages from the server
connection.listen();

async function initializeServer(rootUri) {
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
