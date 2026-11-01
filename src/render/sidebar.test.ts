import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Input: { Events: { GAMEOBJECT_POINTER_DOWN: 'down' } } } }));

import { Sidebar } from './sidebar';

/** A text object that knows its position and a height from its font size, like Phaser's. */
function fakeText(size: number) {
  const t = {
    x: 0,
    y: 0,
    text: '',
    height: Math.round(size * 1.3),
    setScrollFactor: () => t,
    setDepth: () => t,
    setInteractive: () => t,
    on: () => t,
    setText: (s: string) => ((t.text = s), t),
    setColor: () => t,
    setPosition: (x: number, y: number) => ((t.x = x), (t.y = y), t),
    setVisible: () => t,
  };
  return t;
}

describe('Sidebar layout at 1280x600', () => {
  it('with the escorts line present, boxes do not overlap and end above the Map button', () => {
    const scene = {
      cameras: { add: () => ({ setViewport: () => undefined, setVisible: () => undefined }) },
      add: {
        text: (_x: number, _y: number, text: string, style: { fontSize: string }) => Object.assign(fakeText(parseInt(style.fontSize)), { text }),
        graphics: () => ({ setScrollFactor() { return this; }, setDepth() { return this; }, setVisible() { return this; } }),
      },
    };
    const sb = new Sidebar(scene as never, () => undefined, () => undefined);
    sb.layout(1080, 600);
    const labels = (sb as unknown as { labels: Record<string, ReturnType<typeof fakeText>> }).labels;
    for (const [name, t] of Object.entries(labels)) t.setText(name === 'escorts' ? 'Escorts: 2 · Follow' : name);
    const boxes = sb.boxes();
    const names = boxes.map((b) => b.name);
    expect(names).toContain('escorts');
    expect(names.indexOf('escorts')).toBe(names.indexOf('law') + 1);
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i].top, `${boxes[i].name} starts below ${boxes[i - 1].name}`).toBeGreaterThanOrEqual(boxes[i - 1].bottom);
    }
    const map = boxes[boxes.length - 1];
    expect(map.name).toBe('map');
    const last = boxes[boxes.length - 2];
    expect(last.bottom).toBeLessThanOrEqual(map.top);
    expect(map.bottom).toBeLessThanOrEqual(600);
  });
});
