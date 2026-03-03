export interface LyricLine {
  time: number;
  text: string;
}

export function parseLrc(text: string): LyricLine[] {
  const lines = text.split(/\r?\n/);
  const parsed: LyricLine[] = [];

  for (const line of lines) {
    const timeMatches = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (timeMatches.length === 0) {
      continue;
    }

    const rawText = line.replace(/\[(\d+):(\d+(?:\.\d+)?)\]/g, "").trim();
    for (const match of timeMatches) {
      const minute = Number(match[1]);
      const second = Number(match[2]);
      if (Number.isNaN(minute) || Number.isNaN(second)) {
        continue;
      }
      parsed.push({
        time: minute * 60 + second,
        text: rawText || "..."
      });
    }
  }

  parsed.sort((a, b) => a.time - b.time);
  return parsed;
}
