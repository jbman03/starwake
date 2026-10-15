export type Vec2 = { x: number; y: number };

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (v: Vec2, s: number): Vec2 => ({ x: v.x * s, y: v.y * s });
export const len = (v: Vec2): number => Math.hypot(v.x, v.y);
export const norm = (v: Vec2): Vec2 => {
  const l = len(v);
  return l === 0 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l };
};
export const fromAngle = (rad: number): Vec2 => ({ x: Math.cos(rad), y: Math.sin(rad) });
export const angleOf = (v: Vec2): number => Math.atan2(v.y, v.x);
export const dist = (a: Vec2, b: Vec2): number => len(sub(a, b));
