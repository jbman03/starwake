/** A fake AudioContext for tests: counts the nodes made and logs parameter calls. Test use only. */
export function param() {
  const calls: string[] = [];
  /** Every scheduling call with its time, for tests that pin ramp timing. */
  const timed: { op: 'set' | 'lin' | 'exp' | 'cancel'; v?: number; t: number }[] = [];
  return {
    value: 0,
    calls,
    timed,
    setValueAtTime: (v: number, t = 0) => (calls.push(`set ${v}`), timed.push({ op: 'set', v, t }), undefined),
    linearRampToValueAtTime: (v: number, t = 0) => (calls.push(`lin ${v}`), timed.push({ op: 'lin', v, t }), undefined),
    exponentialRampToValueAtTime: (v: number, t = 0) => (calls.push(`exp ${v}`), timed.push({ op: 'exp', v, t }), undefined),
    cancelScheduledValues: (t = 0) => (timed.push({ op: 'cancel', t }), undefined),
  };
}

/** A fake audio node that records what it is connected to. */
export interface FakeNode {
  to: unknown[];
  connect: (n: unknown) => unknown;
  disconnect: () => void;
}

export function fakeCtx() {
  const made = {
    osc: 0,
    noise: 0,
    gains: [] as ReturnType<typeof param>[],
    /** Every node made (not the destination), and the oscillators and buffer sources among them. */
    nodes: [] as FakeNode[],
    sources: [] as FakeNode[],
    resumed: 0,
    suspended: 0,
    autoRun: true,
  };
  const node = (): FakeNode => {
    const to: unknown[] = [];
    return { to, connect: (n: unknown) => (to.push(n), n), disconnect: () => undefined };
  };
  const made_ = <T extends FakeNode>(n: T, source = false): T => {
    made.nodes.push(n);
    if (source) made.sources.push(n);
    return n;
  };
  const ctx = {
    currentTime: 0,
    sampleRate: 8000,
    state: 'suspended' as string,
    destination: node(),
    resume: () => {
      made.resumed += 1;
      if (made.autoRun) ctx.state = 'running';
      return Promise.resolve();
    },
    suspend: () => {
      made.suspended += 1;
      ctx.state = 'suspended';
      return Promise.resolve();
    },
    createOscillator: () => {
      made.osc += 1;
      return made_({ ...node(), type: 'sine', frequency: param(), start: () => undefined, stop: () => undefined }, true);
    },
    createGain: () => {
      const gain = param();
      made.gains.push(gain);
      return made_({ ...node(), gain });
    },
    createBiquadFilter: () => made_({ ...node(), type: 'lowpass', frequency: param(), Q: param() }),
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => {
      made.noise += 1;
      return made_({ ...node(), buffer: null, loop: false, start: () => undefined, stop: () => undefined }, true);
    },
  };
  return { ctx: ctx as unknown as AudioContext, made, destination: ctx.destination };
}
