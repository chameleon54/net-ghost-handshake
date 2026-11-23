import type { LevelData } from './levelData';
import { isKitModel, kitPrefix } from './modelFit';

// Bringing kit models into the game (5.5b Part 2, decision 289). While trying, a box's model is a file in the owner's kits
// folder outside the repo (`kit:<pack>/<path>`). The editor's "Copy kit models into the game" sends the level to the dev
// server, which copies every such file from a credited pack into src/assets/models/ and renames the boxes' models to the
// game names. This file is the plan (which files, which names), with no file access, so it can be tested.

/**
 * The packs (folder names in the kits folder) whose models may be copied into the game: each has an entry in CREDITS.md
 * and a licence that allows redistributing the files (assets.md). A pack is added here only with its credit.
 */
export const creditedPacks: readonly string[] = ['Lab Assets'];

/**
 * The game's name for a kit file: `prop-` and the file's name in lowercase with hyphens, the pack's repeated first word
 * dropped (Lab Assets names `counter_counter_sink`, `cabinet_cabinet`): `prop-counter-sink`, `prop-cabinet`.
 */
export function gameModelName(kitPath: string): string {
  const file = kitPath.split('/').pop() ?? kitPath;
  const words = file
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');
  if (words.length > 1 && words[0] === words[1]) words.shift();
  return `prop-${words.join('-')}`;
}

/** What one press of the button does: the files to copy (from the kits folder, to a game name) and the level with the new names. */
export interface KitCopyPlan {
  level: LevelData;
  copies: { from: string; to: string }[];
  /** Kit models left as they are, with why (a pack that is not credited, or a file that is not a single .glb). */
  refused: { model: string; why: string }[];
}

/**
 * CREDITS.md with a row for every copied file that has none yet: `| prop-x.glb | <the file's path in the pack> |`, added at
 * the end of the table under the pack's heading (`### <pack>, by ...`). A pack without a heading is left out (the copy
 * refuses it anyway); the tests then fail until its credit is written by hand.
 */
export function creditsWithCopies(credits: string, copies: readonly { from: string; to: string }[]): string {
  const lines = credits.replace(/\r\n/g, '\n').split('\n');
  for (const { from, to } of copies) {
    const file = `${to}.glb`;
    if (lines.some((line) => line.startsWith(`| ${file} |`))) continue;
    const [pack, ...rest] = from.split('/');
    const heading = lines.findIndex((line) => line.startsWith(`### ${pack}`));
    if (heading < 0) continue;
    let end = heading + 1;
    while (end < lines.length && !lines[end].startsWith('|')) end++; // the table's first line
    while (end < lines.length && lines[end].startsWith('|')) end++; // past its last row
    lines.splice(end, 0, `| ${file} | ${rest.join('/')} |`);
  }
  return lines.join('\n');
}

export function planKitCopy(level: LevelData): KitCopyPlan {
  const copies = new Map<string, string>();
  const refused = new Map<string, string>();
  for (const box of level.boxes) {
    if (!box.model || !isKitModel(box.model)) continue;
    const path = box.model.slice(kitPrefix.length);
    const pack = path.split('/')[0];
    if (!creditedPacks.includes(pack)) refused.set(box.model, `the pack "${pack}" has no entry in CREDITS.md`);
    // shortcut: only single-file .glb models are copied (a .gltf or .obj needs its other files too); add them when a credited pack needs it.
    else if (!/\.glb$/i.test(path)) refused.set(box.model, 'only single .glb files can be copied');
    else copies.set(path, gameModelName(path));
  }
  const renamed: LevelData = {
    ...level,
    boxes: level.boxes.map((box) => {
      const path = box.model && isKitModel(box.model) ? box.model.slice(kitPrefix.length) : '';
      const name = copies.get(path);
      return name ? { ...box, model: name } : box;
    }),
  };
  return {
    level: renamed,
    copies: [...copies].map(([from, to]) => ({ from, to })),
    refused: [...refused].map(([model, why]) => ({ model, why })),
  };
}
