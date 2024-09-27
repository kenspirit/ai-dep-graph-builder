import * as graphController from './graph.controller.js';
import { VERTEX_QUERY_SCHEMA } from '../../../graph-builder.js';

export default {
  basePath: '/graph',
  description: 'API Routes for Graph',
  routes: [
    {
      method: 'get',
      path: '/descendants',
      action: [graphController.getDescendants],
      description: 'Load all descendants of a given vertex',
      validators: {
        query: VERTEX_QUERY_SCHEMA
      }
    },
    {
      method: 'get',
      path: '/ancestors',
      action: [graphController.getAncestors],
      description: 'Load all ancestors of a given vertex',
      validators: {
        query: VERTEX_QUERY_SCHEMA
      }
    }
  ]
};
