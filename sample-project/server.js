import express from 'express';
import path from 'path';
import { loadModules } from './server/util/module.loader.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// app.use(express.static(path.join(__dirname, 'build')));

loadModules(path.join(__dirname, 'server'), /.*\.routes\.js$/).then(routeModules => {
  routeModules.forEach(({ loadedModule }) => {
    const moduleRoutes = loadedModule.default;
    if (moduleRoutes.basePath && moduleRoutes.routes && Array.isArray(moduleRoutes.routes)) {
      const router = express.Router();
      moduleRoutes.routes.forEach(route => {
        console.log(`Loading route: POST /api${moduleRoutes.basePath}${route.path}`);
        router[route.method](route.path, ...route.action);
      });
      app.use(`/api${moduleRoutes.basePath}`, router);
    }
  });

  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
});
