/** A fake AudioContext for tests: counts the nodes made and logs parameter calls. Test use only. */
export function param() {
  const calls: string[] = [];
  return {
    value: 0,
    calls,
    setValueAtTime: (v: number) => (calls.push(`set ${v}`), undefined),
    linearRampToValueAtTime: (v: number) => (calls.push(`lin ${v}`), undefined),
    exponentialRampToValueAtTime: (v: number) => (calls.push(`exp ${v}`), undefined),
    cancelScheduledValues: () => undefined,
  };
}

export function fakeCtx() {
  const made = { osc: 0, noise: 0, gains: [] as ReturnType<typeof param>[], resumed: 0, suspended: 0, autoRun: true };
  const node = () => ({ connect: (n: unknown) => n, disconnect: () => undefined });
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
      return { ...node(), type: 'sine', frequency: param(), start: () => undefined, stop: () => undefined };
    },
    createGain: () => {
      const gain = param();
      made.gains.push(gain);
      return { ...node(), gain };
    },
    createBiquadFilter: () => ({ ...node(), type: 'lowpass', frequency: param(), Q: param() }),
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => {
      made.noise += 1;
      return { ...node(), buffer: null, loop: false, start: () => undefined, stop: () => undefined };
    },
  };
  return { ctx: ctx as unknown as AudioContext, made };
}
