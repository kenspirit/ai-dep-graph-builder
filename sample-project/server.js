import express from 'express';
import path from 'path';
import { loadModules } from '../module.loader.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'dist')));

app.use(
  express.urlencoded({
    extended: true,
    parameterLimit: 20000,
    limit: 20000
  })
);
app.use(
  express.json({
    extended: true,
    parameterLimit: 20000,
    limit: 20000
  })
);

loadModules(path.join(__dirname, 'server'), /.*\.routes\.js$/, true).then(routeModules => {
  routeModules.forEach(({ loadedModule }) => {
    const moduleRoutes = loadedModule.default;
    if (moduleRoutes.basePath && moduleRoutes.routes && Array.isArray(moduleRoutes.routes)) {
      const router = express.Router();
      moduleRoutes.routes.forEach(route => {
        console.log(`Loading route: ${route.method} /api${moduleRoutes.basePath}${route.path}`);
        const middlewares = route.action.map((action) => {
          return async function (req, res, next) {
            try {
              const result = action(req, res, next);
              if (result && typeof result.then === 'function') {
                await result;
              }
            } catch (e) {
              next(e);
            }
          };
        });
        router[route.method](route.path, middlewares);
      });
      app.use(`/api${moduleRoutes.basePath}`, router);
    }
  });

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).send('Something broke!');
  });

  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
});
