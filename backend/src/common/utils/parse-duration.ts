const UNITS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
};

/** Parse durasi format jwt ('15m', '7d') menjadi detik. */
export function parseDurationToSeconds(input: string): number {
  const match = /^(\d+)([smhdw])$/.exec(input.trim());
  if (!match) throw new Error(`Format durasi tidak valid: ${input}`);
  return Number(match[1]) * UNITS[match[2]];
}
