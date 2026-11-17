import type { Role } from '../config/roles';

// Who calls out what (4.14, decision 264; dialogue.md "Contractors"). The hooks themselves are sent where the squad's
// actions start (main.ts), only when the AI really does the thing; these pick the speaker when it is not the one acting.

/** What a possible speaker needs: where it is, its role, and whether it is up and fighting. */
export interface Speaker {
  readonly xM: number;
  readonly zM: number;
  readonly role: Role;
  readonly awake: boolean;
}

/** The awake one nearest (x, z), or null. */
function nearestAwake<T extends Speaker>(squad: readonly T[], x: number, z: number): T | null {
  let best: T | null = null;
  let bestM = Infinity;
  for (const member of squad) {
    if (!member.awake) continue;
    const m = Math.hypot(member.xM - x, member.zM - z);
    if (m < bestM) {
      best = member;
      bestM = m;
    }
  }
  return best;
}

/** Who calls a push after hearing Rook's gun ("He's dry, push"): the squad leader if it is up, else the one nearest Rook. */
export function pushCaller<T extends Speaker>(squad: readonly T[], rook: { readonly x: number; readonly z: number }): T | null {
  return squad.find((member) => member.role === 'leader' && member.awake) ?? nearestAwake(squad, rook.x, rook.z);
}

/** Who calls "Man down": the squadmate still up nearest where it fell. */
export function downCaller<T extends Speaker>(squad: readonly T[], at: { readonly x: number; readonly z: number }): T | null {
  return nearestAwake(squad, at.x, at.z);
}

/** A flank's side as Rook sees it, from `StandInWorld.flankSide` (1 or -1). */
export const sideWord = (sign: number): 'left' | 'right' => (sign < 0 ? 'left' : 'right');
