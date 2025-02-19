
import { loadModules } from './sample-project/server/util/module.loader.js';
import { AiProvider, GraphBuilder, registerAiProvider } from './index.js';
import { AstParser } from './ast-parser.java.js';
import BigModel from './ai-providers/bigmodel.js';
import config from './sample.config.js';

let aiProvider;

if (process.env.AI_ENABLED !== 'false') {
  registerAiProvider('BIGMODEL', BigModel);

  aiProvider = new AiProvider(config.defaultAiProvider, config.aiProviders[config.defaultAiProvider]);
}

const builder = new GraphBuilder(config.graph.type, config.graph.connectionOptions);

const rootDir = process.env.PROJECT_ROOT || 'project-root-path'; // Which should probably the directory of pom.xml
const microService = process.env.SERVICE_NAME || 'sample-service';

const astParser = new AstParser(rootDir.replace(/\\/g, '/'));

async function persistVertex(vertex) {
  await builder.createVertex(vertex);
}

async function _getFunctionDescriptionThroughAI(functionSourceCode) {
  if (process.env.AI_ENABLED === 'false') {
    return 'AI NOT ENABLED';
  }
  const response = await aiProvider.getFunctionDescription(functionSourceCode);
  return response.description;
}

function _convertInstanceAndFunctionDependencies(fileName, moduleDependencyMap, dependencies = []) {
  const result = dependencies.map(dependency => {
    const isFunction = ['method', 'constructor'].includes(dependency.type);

    const converted = {
      language: 'java',
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
  const javaClass = await loadModules(rootDir, config.filesMatchingPatterns, false);

  for (const result of javaClass) {
    const { filePath } = result;

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
  }
}

async function buildGraph() {
  await builder.initGraph();
  await astParser.initializeLSP();

  await persistVertex({
    name: microService,
    category: 'microService',
    description: 'Dependency graph builder',
    type: 'mono'
  });

  await buildSystemModuleVertices();
}

buildGraph();
