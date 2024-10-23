import { AiProvider } from '../../../ai-provider.js';
import AiQueryTemplate from '../../../fixtures/ai_query_template.js';
import { getDescendants, getAncestors, getAllAffected, graphBuilder } from '../graph/graph.service.js';
import config from '../../../sample.config.js';

const aiProvider = new AiProvider(config.defaultAiProvider, config.aiProviders[config.defaultAiProvider]);

async function chat(messages) {
  return aiProvider.chat(messages);
}

async function affectedFromComponent(direction, component, changeDescription) {
  let graph;
  let updatedSource = component.sourceCode;

  if (direction === 'descendants') {
    graph = await getDescendants(component);
  } else if (direction === 'ancestors') {
    graph = await getAncestors(component);
  } else {
    graph = await getAllAffected(component);
  }

  const componentInDB = graph.vertices.find((vertex) => {
    return vertex.name === component.name && vertex.systemModule === component.systemModule && vertex.microService === component.microService;
  });
  if (componentInDB) {
    component.sourceCode = componentInDB.sourceCode;
  }

  return aiProvider.chat(AiQueryTemplate.getAffectedFromComponent(component, changeDescription, graph, updatedSource));
}

async function affectedFromBusiness(changeDescription) {
  const vertices = await graphBuilder.getVerticesByTypesWithDescription('Component', ['API', 'UI']);
  const affectedComponents = await aiProvider.chat(AiQueryTemplate.getComponentsMatchedDescription(changeDescription, vertices));
  return JSON.parse(affectedComponents);
}

export {
  chat,
  affectedFromComponent,
  affectedFromBusiness
};
