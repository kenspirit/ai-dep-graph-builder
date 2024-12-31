
import { loadModules } from './sample-project/server/util/module.loader.js';
import { AiProvider, GraphBuilder, registerAiProvider } from './index.js';
import { AstParser } from './ast-parser.java.js';
import BigModel from './ai-providers/bigmodel.js';
import config from './sample.config.js';

registerAiProvider('BIGMODEL', BigModel);

const aiProvider = new AiProvider(config.defaultAiProvider, config.aiProviders[config.defaultAiProvider]);
const builder = new GraphBuilder(config.graph.type, config.graph.connectionOptions);

const rootDir = 'project-root-path'; // Which should probably the directory of pom.xml
const microService = 'sample-service';

const astParser = new AstParser(rootDir.replace(/\\/g, '/'));

async function persistVertex(vertex) {
  await builder.createVertex(vertex);
}

async function _getFunctionDescriptionThroughAI(functionSourceCode) {
  const response = await aiProvider.getFunctionDescription(functionSourceCode);
  return response.description;
}

function _convertInstanceAndFunctionDependencies(fileName, moduleDependencyMap, dependencies = []) {
  const result = dependencies.map(dependency => {
    const isFunction = ['method', 'constructor'].includes(dependency.type);

    const converted = {
      public: dependency.visibility !== 'private',
      visibility: dependency.visibility,
      category: 'component',
      name: dependency.instanceName,
      fileName,
      systemModule: dependency.module,
      microService: microService,
      type: isFunction ? 'Function' : 'Field',
      sourceCode: isFunction ? dependency.sourceCode : dependency.instanceName,
      dependencies: _convertInstanceAndFunctionDependencies(fileName, moduleDependencyMap, dependency.dependencies)
    };

    if (converted.systemModule === 'this') {
      // Follows its parent system module
      delete converted.systemModule;
    }

    return converted;
  });

  return result;
}

async function buildSystemModuleVertices() {
  const fileMatchingPatterns = [
    /.*\.java$/
  ]
  const javaClass = await loadModules(rootDir, fileMatchingPatterns, false);

  for (const result of javaClass) {
    const { filePath } = result;
    // const systemModule = {
    //   category: 'systemModule',
    //   microService: microService,
    //   name,
    //   type: 'Class',
    //   description: loadedModule.description || name,
    //   dependencies: []
    // };

    console.log(`========== Dependencies built for ${filePath} ===========\n`);
    try {
      const { requiredModuleDependencies, instanceAndfunctionDependencies } = await astParser.getDependencies(filePath.replace(`${rootDir}\\`, '').replace(/\\/g, '/'));
      const fileName = instanceAndfunctionDependencies.$name;

      const moduleDependencies = _convertInstanceAndFunctionDependencies(fileName, requiredModuleDependencies, instanceAndfunctionDependencies.dependencies);

      for (const dependency of moduleDependencies) {
        // Only top level public functions are considered
        if (dependency.public && dependency.type === 'Function' && dependency.sourceCode) {
          dependency.description = await _getFunctionDescriptionThroughAI(dependency.sourceCode);
          // dependency.description = 'Testing';
        } else {
          dependency.description = dependency.name;
        }

        await persistVertex(dependency);
      }
    } catch (e) {
      console.error(`Error while building dependencies for ${filePath}`, e);
      continue;
    }

    // await persistVertex(systemModule);
  }
}

async function buildGraph() {
  await persistVertex({
    name: microService,
    category: 'microService',
    description: 'Dependency graph builder',
    type: 'mono'
  });

  await buildSystemModuleVertices();
}

buildGraph();
