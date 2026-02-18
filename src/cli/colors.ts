let enabled = true;

export function setColorsEnabled(v: boolean): void { enabled = v; }
export function isColorEnabled(): boolean { return enabled; }

function wrap(code: string, text: string): string {
  return enabled ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export const dim = (t: string) => wrap('2', t);
export const bold = (t: string) => wrap('1', t);
export const yellow = (t: string) => wrap('33', t);
export const green = (t: string) => wrap('32', t);
export const red = (t: string) => wrap('31', t);
export const cyan = (t: string) => wrap('36', t);
export const boldYellow = (t: string) => wrap('1;33', t);
export const boldCyan = (t: string) => wrap('1;36', t);
export const boldRed = (t: string) => wrap('1;31', t);
export const boldGreen = (t: string) => wrap('1;32', t);
