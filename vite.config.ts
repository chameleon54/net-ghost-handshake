import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, isRunnableDevEnvironment, type Plugin } from 'vite';

// The debug log's writer (decision 260), on the dev server only (`apply: 'serve'`, never in the build): the game's debug
// tools send their lines here once a second, and they are written to debug-log.txt in the project folder (git-ignored),
// so Claude Code can read it. A page load starts the file fresh. The names match src/debug/eventLog.ts.
const debugLogUrl = '/__debug-log';
const debugLogStartHeader = 'x-debug-log-start';
const debugLogFile = 'debug-log.txt';
const maxBatchBytes = 1_000_000; // one second of log is a few KB; anything this big is not the log

function debugLog(): Plugin {
  return {
    name: 'debug-log',
    apply: 'serve',
    configureServer(server) {
      const file = join(server.config.root, debugLogFile);
      server.middlewares.use(debugLogUrl, (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => (body += chunk));
        req.on('end', () => {
          if (body.length > maxBatchBytes) {
            res.statusCode = 413;
            res.end();
            return;
          }
          const fresh = req.headers[debugLogStartHeader] === '1';
          if (fresh) writeFileSync(file, body);
          else appendFileSync(file, body);
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

// The level editor's save (5.2, decision 273), on the dev server only: the edit mode sends the whole level, which must
// pass the level checker (src/level/levelSave.ts), and it is written to src/data/levels/<name>.json, nowhere else. The game
// imports that file, so Vite reloads the page with the saved level. The checker is loaded through the dev server's own
// module runner when a save comes in, so this config imports none of the game's code. The names match levelSave.ts.
const levelSaveUrl = '/__level-save';
const levelNameHeader = 'x-level-name';
const maxLevelBytes = 2_000_000;
const levelsFolder = 'src/data/levels';
type LevelSaveModule = typeof import('./src/level/levelSave');

function levelSave(): Plugin {
  return {
    name: 'level-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(levelSaveUrl, (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        let tooBig = false;
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => {
          body += chunk;
          if (body.length > maxLevelBytes) tooBig = true;
        });
        req.on('end', async () => {
          const environment = server.environments.ssr;
          if (!isRunnableDevEnvironment(environment)) {
            res.statusCode = 500;
            res.end('The dev server cannot run the level checker.');
            return;
          }
          const { levelSaveRequest } = await environment.runner.import<LevelSaveModule>('/src/level/levelSave.ts');
          const header = req.headers[levelNameHeader];
          const result = tooBig ? { ok: false as const, status: 413, message: 'The level is too big to be a level file.' } : levelSaveRequest(typeof header === 'string' ? header : undefined, body);
          if (!result.ok) {
            res.statusCode = result.status;
            res.setHeader('content-type', 'text/plain; charset=utf-8');
            res.end(result.message);
            return;
          }
          writeFileSync(join(server.config.root, levelsFolder, result.fileName), result.text);
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [debugLog(), levelSave()],
});
