import path from 'path';
import fs from 'fs/promises';

export async function loadModules(dir, fileSuffix = '', withRawContent = false) {
  const results = [];
  const files = await fs.readdir(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = await fs.stat(filePath);

    if (stat.isDirectory()) {
      results.push(...await loadModules(filePath, fileSuffix, withRawContent));
    } else if (!fileSuffix || fileSuffix.test(file)) {
      const loadedModule = await import(path.join('file://', filePath));
      if (withRawContent) {
        const rawContent = await fs.readFile(filePath, 'utf8');
        // filePath = filePath.replace(/\\\\/g, '\\');
        results.push({ filePath, loadedModule: loadedModule, rawContent });
      } else {
        results.push({ filePath, loadedModule: loadedModule});
      }
    }
  }

  return results;
}
