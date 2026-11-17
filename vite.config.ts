import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

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

export default defineConfig({
  plugins: [debugLog()],
});
