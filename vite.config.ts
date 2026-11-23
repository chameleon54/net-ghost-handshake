import { appendFileSync, closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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

// The kits being tried (5.5b, decision 287), on the dev server only: model files are read from the owner's kits folder,
// outside the repo, so the game never depends on it. A chosen piece is copied into src/assets/models/ (5.5b Part 2). The
// list gives each model file with the size of everything it uses and its widest texture. Nothing outside the kits folder
// is ever served. The names match src/level/modelFit.ts.
const kitListUrl = '/__kits/list';
const kitFilesUrl = '/__kits/file';
const kitsFolder = '../../game kits'; // from the project folder: WORK/game kits
const modelFile = /\.(glb|gltf|obj)$/i;
const kitFileTypes: Record<string, string> = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.obj': 'text/plain',
  '.mtl': 'text/plain',
};

interface KitFile {
  path: string;
  bytes: number;
  texturePx: number;
}

/** Every model file in every kit, as `<kit folder>/<path>`. A kit with glTF files is listed with those only (most kits also ship the same pieces as OBJ). */
function listKits(root: string): KitFile[] {
  kitFileIndex.clear();
  const files: KitFile[] = [];
  for (const kit of readdirSync(root, { withFileTypes: true })) {
    if (!kit.isDirectory()) continue;
    const models = readdirSync(join(root, kit.name), { recursive: true, encoding: 'utf8' })
      .filter((file) => modelFile.test(file))
      .map((file) => file.split(sep).join('/'));
    const gltf = models.filter((file) => !/\.obj$/i.test(file));
    for (const file of gltf.length > 0 ? gltf : models) files.push(measureKitFile(root, `${kit.name}/${file}`));
  }
  return files;
}

/**
 * A texture a model names but that is not where it says: some kits keep their textures in one shared folder (the MegaKit's
 * `Textures/`) while the models name them as if beside them. Found by name anywhere in the same kit, or null.
 */
function textureElsewhereInKit(root: string, file: string): string | null {
  if (!/\.(png|jpe?g|webp)$/i.test(file)) return null;
  const kit = relative(root, file).split(sep)[0];
  const name = basename(file).toLowerCase();
  let kitFiles = kitFileIndex.get(kit);
  if (!kitFiles) {
    kitFiles = readdirSync(join(root, kit), { recursive: true, encoding: 'utf8' });
    kitFileIndex.set(kit, kitFiles);
  }
  const found = kitFiles.find((path) => basename(path).toLowerCase() === name);
  return found ? join(root, kit, found) : null;
}
/** Each kit's files, read once per listing (a fresh listing, on each page load, sees files added since). */
const kitFileIndex = new Map<string, string[]>();

/** A model file's size with the buffers and textures it uses, and the widest of its PNG textures. */
function measureKitFile(root: string, path: string): KitFile {
  const file = join(root, path);
  const folder = dirname(file);
  const used = new Set([file]);
  try {
    if (/\.obj$/i.test(file)) {
      const mtl = file.replace(/\.obj$/i, '.mtl');
      if (existsSync(mtl)) {
        used.add(mtl);
        for (const line of readFileSync(mtl, 'utf8').split('\n')) {
          const texture = /^\s*map_\w+\s+(.+?)\s*$/.exec(line);
          if (texture) used.add(resolve(folder, texture[1]));
        }
      }
    } else {
      const data = readFileSync(file);
      const json = /\.glb$/i.test(file) ? data.toString('utf8', 20, 20 + data.readUInt32LE(12)) : data.toString('utf8'); // a .glb's first chunk is its JSON
      const gltf = JSON.parse(json) as { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
      for (const item of [...(gltf.buffers ?? []), ...(gltf.images ?? [])]) {
        if (item.uri && !item.uri.startsWith('data:')) used.add(resolve(folder, decodeURIComponent(item.uri)));
      }
    }
  } catch {
    // Unreadable: only the file's own size is counted.
  }
  let bytes = 0;
  let texturePx = 0;
  for (const named of used) {
    const usedFile = existsSync(named) ? named : textureElsewhereInKit(root, named);
    if (!usedFile) continue;
    bytes += statSync(usedFile).size;
    if (/\.png$/i.test(usedFile)) {
      const head = Buffer.alloc(8);
      const handle = openSync(usedFile, 'r');
      const read = readSync(handle, head, 0, 8, 16); // a PNG's width and height, after its signature and header length
      closeSync(handle);
      if (read === 8) texturePx = Math.max(texturePx, head.readUInt32BE(0), head.readUInt32BE(4));
    }
  }
  return { path, bytes, texturePx };
}

function kits(): Plugin {
  return {
    name: 'kits',
    apply: 'serve',
    configureServer(server) {
      const root = resolve(server.config.root, kitsFolder);
      server.middlewares.use(kitListUrl, (_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(existsSync(root) ? listKits(root) : []));
      });
      server.middlewares.use(kitFilesUrl, (req, res) => {
        let file = '';
        try {
          file = resolve(root, decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, ''));
        } catch {
          // A badly encoded address: refused below.
        }
        const inside = file === '' ? '' : relative(root, file);
        const type = kitFileTypes[extname(file).toLowerCase()];
        const outside = inside === '' || inside.startsWith('..') || isAbsolute(inside);
        if (!outside && type && !existsSync(file)) file = textureElsewhereInKit(root, file) ?? file;
        if (outside || !type || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('content-type', type);
        res.end(readFileSync(file));
      });
    },
  };
}

export default defineConfig({
  plugins: [debugLog(), levelSave(), kits()],
});
