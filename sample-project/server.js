import express from 'express';
import { handler } from './build/handler.js';
import path from 'path';
import { loadModules } from './server/util/module.loader.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'build')));

loadModules(path.join(__dirname, 'server'), '.routes.js').then(routeModules => {
  routeModules.forEach(routeModule => {
    if (routeModule.basePath && routeModule.routes && Array.isArray(routeModule.routes)) {
      const router = express.Router();
      routeModule.routes.forEach(route => {
        router[route.method](route.path, ...route.action);
      });
      app.use(routeModule.basePath, router);
    }
  });

  app.use(handler);

  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
});
