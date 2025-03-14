import path from 'path';
import fs from 'fs/promises';

function _matchPattern(patterns, filePath) {
  return patterns.every(pattern => {
    if (pattern instanceof RegExp) {
      return pattern.test(filePath);
    }

    return new RegExp(pattern).test(filePath);
  });
}

export async function loadModules(dir, filePattern = [], loadModule = false, vscExtension = false) {
  const results = [];
  const files = await fs.readdir(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = await fs.stat(filePath);

    if (stat.isDirectory()) {
      results.push(...await loadModules(filePath, filePattern, loadModule, vscExtension));
    } else if (!filePattern || _matchPattern([].concat(filePattern), filePath)) {
      const rawContent = await fs.readFile(filePath, 'utf8');
      if (loadModule) {
        let fileUrl = path.join('file://', filePath);
        if (vscExtension) {
          fileUrl = filePath.replace(/\\/g, '/');
        }
        const loadedModule = await import(fileUrl);
        results.push({ filePath, loadedModule: loadedModule, rawContent });
      } else {
        results.push({ filePath, rawContent });
      }
    }
  }

  return results;
}
