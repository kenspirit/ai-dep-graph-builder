import { GraphBuilder } from '../../../graph-builder.js';
import { default as config} from '../../../sample.config.js';

const graphBuilder = new GraphBuilder(config.graph.type, config.graph.connectionOptions);

export {
  graphBuilder
};
