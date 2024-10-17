import { AiProvider } from '../../../ai-provider.js';
import AiQueryTemplate from '../../../fixtures/ai_query_template.js';
import { getDescendants, getAncestors } from '../graph/graph.service.js';
import config from '../../../sample.config.js';

const aiProvider = new AiProvider(config.defaultAiProvider, config.aiProviders[config.defaultAiProvider]);

async function chat(messages) {
  return aiProvider.chat(messages);
}

async function affectedFromComponent(direction, component, changeDescription) {
  let vertices;

  if (direction === 'descendants') {
    vertices = await getDescendants(component);
  } else {
    vertices = await getAncestors(component);
  }

  return aiProvider.chat(AiQueryTemplate.getAffectedFromComponent(direction, component, changeDescription, vertices));
}

async function affectedFromBusiness(changeDescription) {
  // return graphBuilder.getVerticesByIds(ids);
}

export {
  chat,
  affectedFromComponent,
  affectedFromBusiness
};
