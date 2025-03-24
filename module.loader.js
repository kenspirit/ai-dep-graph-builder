import path from 'path';
import fs from 'fs/promises';

function _matchPattern(patterns, filePath) {
  if (!patterns || !patterns.length) {
    return true;
  }

  return patterns.every(pattern => {
    if (pattern instanceof RegExp) {
      return pattern.test(filePath);
    }

    return new RegExp(pattern).test(filePath);
  });
}

export async function loadModules(dir, filePattern = [], loadModule = false, vscExtension = false) {
  const results = [];
  const dirStat = await fs.stat(dir);
  const filePatterns = [].concat(filePattern);

  if (!dirStat.isDirectory()) {
    // Single file to be loaded
    if (_matchPattern(filePatterns, dir)) {
      const fileResult = await _loadSingleModule(dir, loadModule, vscExtension);
      results.push(fileResult);
    }

    return results;
  }

  const files = await fs.readdir(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = await fs.stat(filePath);

    if (stat.isDirectory()) {
      results.push(...await loadModules(filePath, filePattern, loadModule, vscExtension));
    } else if (_matchPattern(filePatterns, filePath)) {
      const fileResult = await _loadSingleModule(filePath, loadModule, vscExtension);
      results.push(fileResult);
    }
  }

  return results;
}

async function _loadSingleModule(filePath, loadModule, vscExtension = false) {
  const rawContent = await fs.readFile(filePath, 'utf8');
  if (loadModule) {
    let fileUrl = path.join('file://', filePath);
    if (vscExtension) {
      fileUrl = filePath.replace(/\\/g, '/');
    }
    const loadedModule = await import(fileUrl);
    return { filePath, loadedModule: loadedModule, rawContent };
  } else {
    return { filePath, rawContent };
  }
}
