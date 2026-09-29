import type { MajorBodyId } from '../astro/solarsystem';

/** Anything the user can select in the sky. */
export type SkyObject =
  | { kind: 'star'; index: number }
  | { kind: 'body'; id: MajorBodyId }
  | { kind: 'dso'; id: string }
  | { kind: 'smallbody'; id: string }
  | { kind: 'satellite'; noradId: number }
  | { kind: 'constellation'; id: string }
  | { kind: 'moonlet'; name: string }
  | { kind: 'radiant'; id: string };

export function sameObject(a: SkyObject | null, b: SkyObject | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'star':
      return a.index === (b as typeof a).index;
    case 'satellite':
      return a.noradId === (b as typeof a).noradId;
    case 'moonlet':
      return a.name === (b as typeof a).name;
    default:
      return a.id === (b as { id: string }).id;
  }
}

export function objectKey(o: SkyObject): string {
  switch (o.kind) {
    case 'star':
      return `star:${o.index}`;
    case 'satellite':
      return `sat:${o.noradId}`;
    case 'moonlet':
      return `moonlet:${o.name}`;
    default:
      return `${o.kind}:${o.id}`;
  }
}
