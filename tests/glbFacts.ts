// Reads what the asset rules need straight from a .glb file's bytes, with no browser: its triangles and the size of the
// pictures stored inside it (5.5b Part 2). A .glb is a small header, a JSON part that describes the model, then the binary
// part with the numbers and the pictures. Used by tests only.

export interface GlbFacts {
  triangles: number;
  /** The width or height (whichever is bigger) of every PNG picture stored inside the file. */
  texturePx: number[];
  /** Pictures that are not PNG inside the file (their size is not read), or that live in another file (a .glb copied alone would lose them). */
  otherImages: string[];
}

interface GltfJson {
  accessors?: { count: number }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[];
  nodes?: { mesh?: number }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
  bufferViews?: { byteOffset?: number; byteLength: number }[];
}

const glbMagic = 0x46546c67; // "glTF"
const headerBytes = 12;
const chunkHeaderBytes = 8;
const trianglesMode = 4;
/** In a PNG, the width and height (4 bytes each, big-endian) start this far in. */
const pngWidthAt = 16;

export function glbFacts(bytes: Uint8Array): GlbFacts {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== glbMagic) throw new Error('not a .glb file');
  const jsonLength = view.getUint32(headerBytes, true);
  const jsonStart = headerBytes + chunkHeaderBytes;
  const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(jsonStart, jsonStart + jsonLength))) as GltfJson;
  const binStart = jsonStart + jsonLength + chunkHeaderBytes;

  // Each mesh counts once for every node that places it (a mesh used twice is drawn twice).
  const uses = new Map<number, number>();
  for (const node of gltf.nodes ?? []) if (node.mesh !== undefined) uses.set(node.mesh, (uses.get(node.mesh) ?? 0) + 1);
  let triangles = 0;
  (gltf.meshes ?? []).forEach((mesh, index) => {
    for (const primitive of mesh.primitives) {
      if ((primitive.mode ?? trianglesMode) !== trianglesMode) continue;
      const counted = primitive.indices !== undefined ? primitive.indices : primitive.attributes.POSITION;
      triangles += ((gltf.accessors?.[counted]?.count ?? 0) / 3) * (uses.get(index) ?? 1);
    }
  });

  const texturePx: number[] = [];
  const otherImages: string[] = [];
  (gltf.images ?? []).forEach((image, index) => {
    const part = image.bufferView !== undefined ? gltf.bufferViews?.[image.bufferView] : undefined;
    if (!part || image.mimeType !== 'image/png') {
      otherImages.push(image.uri ?? `image ${index} (${image.mimeType ?? 'unknown type'})`);
      return;
    }
    const start = binStart + (part.byteOffset ?? 0);
    texturePx.push(Math.max(view.getUint32(start + pngWidthAt, false), view.getUint32(start + pngWidthAt + 4, false)));
  });
  return { triangles, texturePx, otherImages };
}
