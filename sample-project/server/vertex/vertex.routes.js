import * as vertexController from './vertex.controller.js';
import { VERTEX_SCHEMA } from '../../../graph-builder.js';
import joi from 'joi';

export default {
  basePath: '/vertex',
  description: 'API Routes for Vertex',
  routes: [
    {
      method: 'get',
      path: '/',
      action: [vertexController.getVerticesByCategory],
      description: 'Load all vertex given a specific category',
      validators: {
        query: joi.object().keys({
          category: joi.string().required().valid('BusinessModule', 'MicroService', 'SystemModule', 'Component')
        })
      }
    },
    {
      method: 'post',
      path: '/',
      action: [vertexController.createVertex],
      description: 'Create a vertex',
      validators: {
        body: VERTEX_SCHEMA
      }
    }
  ]
};
