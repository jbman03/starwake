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

/** What happened to a node: disconnect calls, and for sources the start and stop times. */
export interface NodeLog {
  disconnects: number;
  starts: number[];
  stops: number[];
}

/** A fake audio node that records what it is connected to. */
export interface FakeNode {
  to: unknown[];
  log: NodeLog;
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
  // Spread into richer nodes below, so the state lives in shared objects, not copied fields.
  const node = (): FakeNode => {
    const to: unknown[] = [];
    const log: NodeLog = { disconnects: 0, starts: [], stops: [] };
    return { to, log, connect: (n: unknown) => (to.push(n), n), disconnect: () => void (log.disconnects += 1) };
  };
  const source = () => {
    const n = node();
    return { ...n, start: (t = 0) => void n.log.starts.push(t), stop: (t = 0) => void n.log.stops.push(t) };
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
      return made_({ ...source(), type: 'sine', frequency: param(), detune: param() }, true);
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
      return made_({ ...source(), buffer: null, loop: false }, true);
    },
  };
  return { ctx: ctx as unknown as AudioContext, made, destination: ctx.destination };
}
