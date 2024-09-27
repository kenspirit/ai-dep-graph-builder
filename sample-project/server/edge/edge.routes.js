import * as edgeController from './edge.controller.js';
import { VERTEX_QUERY_SCHEMA } from '../../../graph-builder.js';
import joi from 'joi';

export default {
  basePath: '/edge',
  description: 'API Routes for Edge',
  routes: [
    {
      method: 'get',
      path: '/',
      action: [edgeController.getEdge],
      description: 'Load an edge given from and to vertex',
      validators: {
        query: joi.object().keys({
          from: VERTEX_QUERY_SCHEMA,
          to: VERTEX_QUERY_SCHEMA
        })
      }
    },
    {
      method: 'post',
      path: '/',
      action: [edgeController.createEdge],
      description: 'Create an edge given from and to vertex',
      validators: {
        body: joi.object().keys({
          from: VERTEX_QUERY_SCHEMA,
          to: VERTEX_QUERY_SCHEMA
        })
      }
    }
  ]
};

