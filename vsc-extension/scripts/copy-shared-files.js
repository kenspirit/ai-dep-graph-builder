const fs = require('fs-extra');
const path = require('path');

const filesToCopy = [
  'index.js',
  'ai-provider.js',
  'graph-builder.js',
  'lsp-client.js',
  'module.loader.js',
  'repo-builder.js'
];

const directoriesToCopy = [
  'fixtures',
  'repo-builders',
  'ai-providers',
  'graph-connectors',
  'parsers'
];

const sharedDir = '../../';
const targetDir = '../src/shared/';
fs.ensureDirSync(path.join(__dirname, sharedDir));

function replaceImmediateRunSection(data) {
  data = data.replace(/import\.meta\.url/g, '__filename');
  const targetLine = 'if (isDirectlyExecuted()) {';
  const lineIndex = data.indexOf(targetLine);

  if (lineIndex !== -1) {
    data = data.substring(0, lineIndex);
  }
  return data;
}

filesToCopy.forEach(file => {
  const sourcePath = path.join(__dirname, sharedDir, file);
  const fileName = path.basename(file);
  const targetPath = path.join(__dirname, targetDir, fileName);
  
  fs.copySync(sourcePath, targetPath);
  if (fileName === 'repo-builder.js') {
    const data = fs.readFileSync(targetPath, 'utf8');
    fs.writeFileSync(targetPath, replaceImmediateRunSection(data));
  }
  console.log(`Copied ${sourcePath} to ${targetPath}`);
});

directoriesToCopy.forEach(dir => {
  const sourcePath = path.join(__dirname, sharedDir, dir);
  const dirName = path.basename(dir);
  const targetPath = path.join(__dirname, targetDir, dirName);
  
  fs.copySync(sourcePath, targetPath);
  if (dirName === 'repo-builders') {
    const data = fs.readFileSync(targetPath + '/javascript.js', 'utf8');
    fs.writeFileSync(targetPath + '/javascript.js', replaceImmediateRunSection(data));
  }
  console.log(`Copied directory ${sourcePath} to ${targetPath}`);
}); 
