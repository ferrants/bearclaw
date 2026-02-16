/**
 * Minimal YAML frontmatter parser for SKILL.md files.
 * Handles the subset we need: scalars, arrays of objects, nested objects.
 * No external dependencies.
 */

export function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { data: {}, body: content };
  }
  const yaml = match[1];
  const body = match[2];
  return { data: parseYaml(yaml), body };
}

function parseYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('#')) {
      i++;
      continue;
    }

    const topMatch = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!topMatch) {
      i++;
      continue;
    }

    const key = topMatch[1];
    const inlineValue = topMatch[2].trim();

    if (inlineValue && !inlineValue.startsWith('#')) {
      // Inline scalar — parse value (handles booleans, numbers, inline arrays/objects)
      result[key] = parseValue(inlineValue);
      i++;
    } else {
      // Check next line for array or nested object
      i++;
      if (i < lines.length && lines[i].match(/^\s+- /)) {
        // Array of items
        const arr: unknown[] = [];
        while (i < lines.length && lines[i].match(/^\s+- /)) {
          const itemMatch = lines[i].match(/^\s+- (.+)$/);
          if (itemMatch) {
            const firstField = itemMatch[1].trim();
            const objMatch = firstField.match(/^(\w[\w-]*):\s*(.*)$/);
            if (objMatch) {
              // Array of objects
              const obj: Record<string, unknown> = {};
              obj[objMatch[1]] = parseValue(objMatch[2].trim());
              i++;
              // Collect remaining fields of this object
              while (i < lines.length) {
                const fieldMatch = lines[i].match(/^(\s{4,})(\w[\w-]*):\s*(.*)$/);
                if (!fieldMatch || lines[i].match(/^\s+- /)) break;
                const val = fieldMatch[3].trim();
                if (!val || val === '') {
                  // Nested object or array
                  i++;
                  const nested = collectNested(lines, i, getIndent(lines[i - 1]) + 2);
                  obj[fieldMatch[2]] = nested.value;
                  i = nested.nextIndex;
                } else {
                  obj[fieldMatch[2]] = parseValue(val);
                  i++;
                }
              }
              arr.push(obj);
            } else {
              // Simple array item
              arr.push(stripQuotes(firstField));
              i++;
            }
          } else {
            i++;
          }
        }
        result[key] = arr;
      } else if (i < lines.length && lines[i].match(/^\s+\w/)) {
        // Nested object
        const nested = collectNestedObject(lines, i);
        result[key] = nested.value;
        i = nested.nextIndex;
      } else {
        result[key] = '';
      }
    }
  }

  return result;
}

function collectNested(lines: string[], start: number, minIndent: number): { value: unknown; nextIndex: number } {
  if (start < lines.length && lines[start].match(new RegExp(`^\\s{${minIndent},}- `))) {
    // Array
    const arr: unknown[] = [];
    let i = start;
    while (i < lines.length && lines[i].match(new RegExp(`^\\s{${minIndent},}- `))) {
      const m = lines[i].match(/^\s+- (.+)$/);
      if (m) arr.push(stripQuotes(m[1].trim()));
      i++;
    }
    return { value: arr, nextIndex: i };
  }
  // Object
  return collectNestedObject(lines, start);
}

function collectNestedObject(lines: string[], start: number): { value: Record<string, unknown>; nextIndex: number } {
  const obj: Record<string, unknown> = {};
  let i = start;
  const baseIndent = getIndent(lines[i]);
  if (baseIndent === 0) return { value: obj, nextIndex: i };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const indent = getIndent(line);
    if (indent < baseIndent) break;
    if (indent > baseIndent) { i++; continue; }

    const m = line.match(/^\s+(\w[\w-]*):\s*(.*)$/);
    if (!m) { i++; continue; }

    const val = m[2].trim();
    if (!val) {
      i++;
      const nested = collectNested(lines, i, indent + 2);
      obj[m[1]] = nested.value;
      i = nested.nextIndex;
    } else {
      obj[m[1]] = parseValue(val);
      i++;
    }
  }
  return { value: obj, nextIndex: i };
}

function getIndent(line: string): number {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

function parseValue(val: string): unknown {
  if (!val) return '';
  const stripped = stripQuotes(val);
  if (stripped === 'true') return true;
  if (stripped === 'false') return false;
  if (stripped === 'null') return null;
  if (/^-?\d+$/.test(stripped)) return parseInt(stripped, 10);
  if (/^-?\d+\.\d+$/.test(stripped)) return parseFloat(stripped);
  // Inline array: [a, b, c]
  if (val.startsWith('[') && val.endsWith(']')) {
    return val.slice(1, -1).split(',').map(s => stripQuotes(s.trim()));
  }
  // Inline object: { key: val }
  if (val.startsWith('{') && val.endsWith('}')) {
    const obj: Record<string, unknown> = {};
    const pairs = val.slice(1, -1).split(',');
    for (const pair of pairs) {
      const [k, ...rest] = pair.split(':');
      if (k && rest.length > 0) {
        obj[k.trim()] = parseValue(rest.join(':').trim());
      }
    }
    return obj;
  }
  return stripped;
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}
