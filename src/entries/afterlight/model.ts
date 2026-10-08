export type Star = {x: number; y: number; gesture: number};

export const MAX_STARS = 96;
export const MIN_DISTANCE = 0.035;
export const SCALE = [0, 2, 4, 7, 9];
export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function random(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function addStar(stars: Star[], x: number, y: number, gesture: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || stars.length >= MAX_STARS) return false;
  const star = {x: clamp(x, 0, 1), y: clamp(y, 0, 1), gesture};
  if (stars.some(s => Math.hypot(s.x - star.x, s.y - star.y) < MIN_DISTANCE)) return false;
  stars.push(star);
  return true;
}

export function connections(stars: readonly Star[]) {
  const edges: [number, number][] = [];
  for (let i = 1; i < stars.length; i++) {
    let nearest = -1, distance = 0.23;
    for (let j = 0; j < i; j++) {
      const d = Math.hypot(stars[i].x - stars[j].x, stars[i].y - stars[j].y);
      if (d < distance) {nearest = j; distance = d;}
    }
    if (nearest !== -1) edges.push([nearest, i]);
  }
  return edges;
}

export function frequency(star: Pick<Star, "y">) {
  const degree = Math.min(14, Math.floor((1 - star.y) * 15));
  const midi = 48 + SCALE[degree % 5] + 12 * Math.floor(degree / 5);
  return 440 * 2 ** ((midi - 69) / 12);
}

export function encode(stars: readonly Star[]) {
  return 'v1.' + stars.map(s => [Math.round(s.x * 1000), Math.round(s.y * 1000), s.gesture].join(',')).join(';');
}

export function decode(value: string): Star[] {
  if (!value.startsWith('v1.') || value.length > 2400) throw new Error('This constellation link is not supported.');
  if (value === 'v1.') return [];
  const rows = value.slice(3).split(';');
  if (rows.length > MAX_STARS) throw new Error('This constellation has too many stars.');
  return rows.map(row => {
    const fields = row.split(',');
    if (fields.length !== 3 || fields.some(s => !/^\d{1,4}$/.test(s))) throw new Error('This constellation link is damaged.');
    const [x,y,gesture] = fields.map(Number);
    if (x > 1000 || y > 1000 || gesture > 9999) throw new Error('This constellation link is damaged.');
    return {x: x / 1000, y: y / 1000, gesture};
  });
}
