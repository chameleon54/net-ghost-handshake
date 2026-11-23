import { describe, expect, it } from 'vitest';
import { checkLevel } from '../src/level/levelData';
import { modelCount, noModelGroup, noModelGroupName } from '../src/level/levelEdit';
import { creditsWithCopies, gameModelName, planKitCopy } from '../src/level/kitCopy';

// Copying kit models into the game (5.5b Part 2, decision 289), and the editor's count of what still has no model.

const level = () =>
  checkLevel({
    formatVersion: 5,
    name: 'kits',
    floor: { widthM: 10, depthM: 10, surfaces: [], hazards: [] },
    start: { id: 'start', xM: 0, zM: 0, yawDeg: 0 },
    dummies: [],
    spawns: [],
    boxes: [
      { id: 'bench-a', label: 'bench', kind: 'prop', xM: 1, zM: 1, widthM: 1, depthM: 1, heightM: 1, model: 'kit:Lab Assets/GLB/All/counter_counter_sink.glb' },
      { id: 'bench-b', label: 'bench', kind: 'prop', xM: 3, zM: 1, widthM: 1, depthM: 1, heightM: 1, model: 'kit:Lab Assets/GLB/Furniture/Counters/counter_counter_sink.glb' },
      { id: 'cabinet', label: 'cabinet', kind: 'prop', xM: 5, zM: 1, widthM: 1, depthM: 1, heightM: 2, model: 'kit:Lab Assets/GLB/All/cabinet_cabinet.glb', modelYawDeg: 90 },
      { id: 'rack', label: 'server rack', kind: 'prop', xM: 7, zM: 1, widthM: 1, depthM: 1, heightM: 2, model: 'kit:kenny modular spacestation/kenney_space-station-kit/Models/GLB format/computer.glb' },
      { id: 'mega', label: 'console', kind: 'prop', xM: 1, zM: 3, widthM: 1, depthM: 1, heightM: 1, model: 'kit:Lab Assets/somewhere/console.gltf' },
      { id: 'done', label: 'desk', kind: 'prop', xM: 3, zM: 3, widthM: 1, depthM: 1, heightM: 1, model: 'prop-desk' },
      { id: 'crate', label: 'crate', kind: 'prop', xM: 5, zM: 3, widthM: 1, depthM: 1, heightM: 1 },
      { id: 'pane', label: 'window', kind: 'prop', xM: 7, zM: 3, widthM: 1, depthM: 0.1, heightM: 2, glass: true },
      { id: 'wall', label: 'wall', kind: 'wall', xM: 0, zM: 5, widthM: 10, depthM: 0.2, heightM: 3 },
    ],
    coverAdd: [],
    coverRemove: [],
    acousticZones: [],
    speakers: [],
    arrivals: [],
  });

describe('game names for kit files', () => {
  it('prop- and the file name in lowercase with hyphens, the repeated first word dropped', () => {
    expect(gameModelName('Lab Assets/GLB/All/counter_counter_sink.glb')).toBe('prop-counter-sink');
    expect(gameModelName('Lab Assets/GLB/All/cabinet_cabinet.glb')).toBe('prop-cabinet');
    expect(gameModelName('Lab Assets/GLB/All/cabinet_cabinet_two_shelves.glb')).toBe('prop-cabinet-two-shelves');
    expect(gameModelName('Lab Assets/GLB/All/ppe_fire_extinguisher_clamp.glb')).toBe('prop-ppe-fire-extinguisher-clamp');
    expect(gameModelName('Pack/Big Crate (2).GLB')).toBe('prop-big-crate-2');
  });
});

describe('planning a copy', () => {
  it('copies .glb files from credited packs and renames the boxes; the same file stored twice gets one name', () => {
    const plan = planKitCopy(level());
    expect(plan.copies.map((copy) => copy.to).sort()).toEqual(['prop-cabinet', 'prop-counter-sink', 'prop-counter-sink']);
    const model = (id: string) => plan.level.boxes.find((box) => box.id === id)?.model;
    expect(model('bench-a')).toBe('prop-counter-sink');
    expect(model('bench-b')).toBe('prop-counter-sink');
    expect(model('cabinet')).toBe('prop-cabinet');
    expect(plan.level.boxes.find((box) => box.id === 'cabinet')?.modelYawDeg).toBe(90); // the turn is kept
    expect(model('done')).toBe('prop-desk');
  });

  it('leaves a pack without credit and a file that is not a single .glb as they are, and says why', () => {
    const plan = planKitCopy(level());
    expect(plan.refused.map((item) => item.why)).toEqual(['the pack "kenny modular spacestation" has no entry in CREDITS.md', 'only single .glb files can be copied']);
    expect(plan.level.boxes.find((box) => box.id === 'rack')?.model).toMatch(/^kit:/);
    expect(plan.level.boxes.find((box) => box.id === 'mega')?.model).toMatch(/^kit:/);
  });

  it('the renamed level still passes the checker', () => {
    expect(() => checkLevel(JSON.parse(JSON.stringify(planKitCopy(level()).level)))).not.toThrow();
  });
});

describe('credits for copied files', () => {
  const credits = ['# Credits', '', '### Lab Assets, by MilkAndBanana', '', '- **Licence:** CC0', '', '| File in this repo | Original file in the pack |', '|---|---|', '| prop-old.glb | GLB/All/old.glb |', '', '### Other pack', '', '| File | Original |', '|---|---|', ''].join('\n');

  it('adds a row under the pack for each new file, once', () => {
    const copies = [
      { from: 'Lab Assets/GLB/All/counter_counter_sink.glb', to: 'prop-counter-sink' },
      { from: 'Lab Assets/GLB/Furniture/Counters/counter_counter_sink.glb', to: 'prop-counter-sink' },
      { from: 'Lab Assets/GLB/All/old.glb', to: 'prop-old' },
    ];
    const lines = creditsWithCopies(credits, copies).split('\n');
    expect(lines.filter((line) => line.startsWith('| prop-counter-sink.glb |'))).toEqual(['| prop-counter-sink.glb | GLB/All/counter_counter_sink.glb |']);
    expect(lines.indexOf('| prop-counter-sink.glb | GLB/All/counter_counter_sink.glb |')).toBe(lines.indexOf('| prop-old.glb | GLB/All/old.glb |') + 1);
    expect(lines.filter((line) => line.startsWith('| prop-old.glb'))).toHaveLength(1);
  });

  it('leaves a pack without a heading out', () => {
    expect(creditsWithCopies(credits, [{ from: 'Unknown/x.glb', to: 'prop-x' }])).toBe(credits);
  });
});

describe('what still has no model (the editor and the asset tracker)', () => {
  it('counts the drawn equipment, not walls or glass', () => {
    expect(modelCount(level())).toEqual({ withModel: 6, total: 7 });
  });

  it('lists the grey ones in their own folder, filtered by the search', () => {
    expect(noModelGroup(level(), '')).toEqual({ name: noModelGroupName, entries: [{ id: 'crate', label: 'crate' }] });
    expect(noModelGroup(level(), 'bench')).toBeNull();
  });
});
