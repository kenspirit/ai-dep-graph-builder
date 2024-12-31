import path from 'path';
import fs from 'fs/promises';

function _matchPattern(patterns, filePath) {
  return patterns.every(pattern => pattern.test(filePath));
}

export async function loadModules(dir, filePattern = [], loadModule = false) {
  const results = [];
  const files = await fs.readdir(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = await fs.stat(filePath);

    if (stat.isDirectory()) {
      results.push(...await loadModules(filePath, filePattern, loadModule));
    } else if (!filePattern || _matchPattern([].concat(filePattern), filePath)) {
      const rawContent = await fs.readFile(filePath, 'utf8');
      if (loadModule) {
        const loadedModule = await import(path.join('file://', filePath));
        // filePath = filePath.replace(/\\\\/g, '\\');
        results.push({ filePath, loadedModule: loadedModule, rawContent });
      } else {
        results.push({ filePath, rawContent });
      }
    }
  }

  return results;
}
