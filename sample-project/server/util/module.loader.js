import path from 'path';
import fs from 'fs/promises';

export async function loadModules(dir, fileSuffix) {
  const results = [];
  const files = await fs.readdir(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = await fs.stat(filePath);

    if (stat.isDirectory()) {
      results.push(...await loadModules(filePath, fileSuffix));
    } else if (file.endsWith(fileSuffix)) {
      const routeModule = await import(path.join('file://', filePath));
      results.push(routeModule.default);
    }
  }

  return results;
}
