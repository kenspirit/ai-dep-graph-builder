
import path from 'path';
import { fileURLToPath } from 'url';
import { loadModules } from '../module.loader.js';
import { RepoBuilder } from '../repo-builder.js';

class CustomNodeProjectBuilder extends RepoBuilder {
  async buildGraph(parsedDirOrFile) {
    parsedDirOrFile = await super.buildGraph(parsedDirOrFile);

    await this.buildSystemModuleVerticesFromRouteModules(this.microService, parsedDirOrFile);
  }

  convertGraphComponents(fileName, language, microService, moduleDependencyMap, dependencies = []) {
    const result = dependencies.map(dependency => {
      const isFunction = dependency.type === 'method';

      const converted = {
        language: language,
        public: dependency.public,
        category: 'component',
        name: dependency.instanceName,
        systemModule: dependency.module,
        microService: microService,
        type: isFunction ? 'Function' : 'Field',
        sourceCode: isFunction ? dependency.sourceCode : dependency.instanceName,
        dependencies: _convertInstanceAndFunctionDependencies(this.rootDir, fileName, language, microService, moduleDependencyMap, dependency.dependencies)
      };

      _setSystemModule(this.rootDir, converted, fileName);

      return converted;
    });

    return result.filter(dependency => !NATIVE_MODULES.includes(dependency.systemModule));
  }

  async buildSystemModuleVerticesFromRouteModules(microService, parsedDirOrFile) {
    const routeModules = await loadModules(parsedDirOrFile || this.rootDir, /.*\.routes\.js$/, true, this.config.vscExtension);

    for (const result of routeModules) {
      const { filePath, loadedModule, rawContent } = result;
      const suffix = filePath.split('.').pop().toLowerCase();
      const language = this.getLanguage(suffix);

      const moduleRoutes = loadedModule.default;
      if (moduleRoutes.basePath && moduleRoutes.routes && Array.isArray(moduleRoutes.routes)) {
        const systemModuleName = filePath.replace(this.rootDir, '').replace(/\\/g, '/');
        const astParser = await this.getAstParser(suffix);
        if (!astParser) {
          continue;
        }

        console.log(`========== Dependencies built for ${filePath} ===========\n`);
        const { requiredModuleDependencies } = astParser.getDependencies(systemModuleName, rawContent);
        const moduleDependencyMap = await _getModuleDependencyMapping(this.rootDir, filePath, requiredModuleDependencies);
        const parsedRoutes = _getValidatorsAndActionMapping(astParser, moduleRoutes.basePath, rawContent);

        for (const route of moduleRoutes.routes) {
          const name = `${route.method} ${moduleRoutes.basePath}${route.path}`;
          const parsedRoute = parsedRoutes[name];

          const component = {
            category: 'component',
            language,
            name,
            type: 'API',
            systemModule: systemModuleName,
            microService: microService,
            description: route.description || name,
            sourceCode: parsedRoute.validators,
            dependencies: []
          };

          for (const action of parsedRoute.actions) {
            const [moduleIdentifier, functionName] = action.split('.');
            const moduleDependency = moduleDependencyMap[moduleIdentifier];
            if (!moduleDependency) {
              console.warn(`Missing Dependency for route ${name} action: ${action}`);
              continue;
            }

            component.dependencies.push({
              category: 'component',
              language,
              name: functionName,
              type: 'Function',
              systemModule: moduleDependency.dependencyName
            });
          }

          await this.persistVertex(component);
        }
      }
    }
  }
}

function _resolveRelativeModulePath(rootDir, filePath, relativeModulePath) {
  const dependencyPath = path.resolve(rootDir, path.dirname(filePath), relativeModulePath);
  const dependencyName = dependencyPath.replace(rootDir, '').replace(/\\/g, '/');
  return { dependencyPath, dependencyName };
}

async function _getModuleDependencyMapping(rootDir, filePath, requiredModuleDependencies) {
  const result = {};
  for (const identifier in requiredModuleDependencies) {
    const source = requiredModuleDependencies[identifier].source;

    if (source.startsWith('.')) {
      result[identifier] = _resolveRelativeModulePath(rootDir, filePath, source);
    } else {
      result[identifier] = { dependencyName: identifier };
    }
  }

  return result;
}

function traverse(cursor, result) {
  const node = cursor.currentNode;

  if (node.type == 'object') {
    // Start of a new route object definition
    result.push({ actions: [] });
  }

  if (node.type === 'pair' && node.firstChild.type === 'property_identifier') {
    const route = result[result.length - 1];

    switch (node.firstChild.text) {
      case 'method':
      case 'path':
        route[node.firstChild.text] = node.lastChild.text.replace(/['"]/g, '');
        break;
      case 'action':
        const actionNode = node.lastChild;
        if (actionNode.type === 'array') {
          const route = result[result.length - 1];
          for (let i = 0; i < actionNode.namedChildCount; i++) {
            const element = actionNode.namedChild(i);
            if (element.type === 'member_expression') {
              route.actions.push(element.text);
            }
          }
        } else {
          route.actions.push(actionNode.text);
        }

        break;
      case 'validators':
        route.validators = node.lastChild.text;
        // Collect info done for current route, prepare to the next route
        cursor.gotoNextSibling();
        break;
    }
  }

  if (cursor.gotoFirstChild()) {
    do {
      traverse(cursor, result);
    } while (cursor.gotoNextSibling());
    cursor.gotoParent();
  }
}

function _getValidatorsAndActionMapping(astParser, basePath, rawContent) {
  const tree = astParser.parse(rawContent);
  const result = [];

  traverse(tree.walk(), result);

  return result.filter(route => route.actions.length > 0).reduce((mapping, route) => {
    mapping[`${route.method} ${basePath}${route.path}`] = route;
    return mapping;
  }, {});
}

const NATIVE_MODULES = ['JSON', 'Set', 'Array', 'Map', 'console', 'Error', 'Buffer', 'Promise', 'Uint8Array', 'Date', 'process', 'require'];

function _setSystemModule(rootDir, dependency, systemModuleName) {
  dependency.systemModule = dependency.systemModule || '';
  if (dependency.systemModule === '$file') {
    dependency.systemModule = systemModuleName;
  }
  if (dependency.systemModule.startsWith('@/')) {
    dependency.systemModule = dependency.systemModule.replace('@/', './src/');
  }
  if (dependency.systemModule.startsWith('.')) {
    // Resolve relative path
    const { dependencyName } = _resolveRelativeModulePath(rootDir, `./${systemModuleName}`, dependency.systemModule);
    dependency.systemModule = dependencyName;
  }
  if (dependency.systemModule === 'this') {
    // Follows its parent system module
    delete dependency.systemModule;
  };
}

function _convertInstanceAndFunctionDependencies(rootDir, systemModuleName, language, microService, moduleDependencyMap, dependencies = []) {
  const result = dependencies.map(dependency => {
    const isFunction = dependency.type === 'method';

    const converted = {
      language,
      public: dependency.public,
      category: 'component',
      name: dependency.instanceName,
      systemModule: dependency.module,
      microService: microService,
      type: isFunction ? 'Function' : (dependency.type === 'string' ? 'String' : 'Field'),
      dependencies: _convertInstanceAndFunctionDependencies(rootDir, systemModuleName, language, microService, moduleDependencyMap, dependency.dependencies)
    };
    if (['Function', 'String'].includes(converted.type)) {
      converted.sourceCode = dependency.sourceCode || dependency.instanceName;
    }

    _setSystemModule(rootDir, converted, systemModuleName);

    return converted;
  });

  return result.filter(dependency => !NATIVE_MODULES.includes(dependency.systemModule));
}

export {
  CustomNodeProjectBuilder as RepoBuilder
}

export function isDirectlyExecuted() {
  if (!process.argv || process.argv.length === 0) {
    return false;
  }

  return process.argv[1] === fileURLToPath(import.meta.url);
}

if (isDirectlyExecuted()) {
  const parsedDirOrFile = process.argv[2];
  if (parsedDirOrFile) {
    // Single directory or file is passed
    if (!process.env.PROJECT_ROOT) {
      console.error('Please set PROJECT_ROOT environment variable to the root directory of the project');
      process.exit(1);
    }
  }

  const currentFileName = fileURLToPath(import.meta.url);
  const currentDirName = path.dirname(currentFileName);

  // Executed through node, read from config file & environment variables
  const rootDir = process.env.PROJECT_ROOT || path.join(currentDirName, '../sample-project/server');
  const microService = process.env.SERVICE_NAME || 'dep-graph-builder';
  const config = await import(path.join('file://', path.join(currentDirName, '../sample.config.js')));
  config.default.aiEnabled = process.env.AI_ENABLED === 'true';

  const builder = new CustomNodeProjectBuilder(rootDir, microService, config.default);
  await builder.buildGraph(parsedDirOrFile);
  process.exit(0);
}
