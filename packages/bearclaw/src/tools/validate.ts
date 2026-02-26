export function validateArgs(
  schema: Record<string, unknown>,
  args: Record<string, unknown>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (schema.type !== 'object') {
    return { valid: true, errors: [] };
  }

  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = (schema.required ?? []) as string[];

  // Check required fields
  for (const name of required) {
    if (args[name] === undefined || args[name] === null) {
      errors.push(`Missing required parameter: ${name}`);
    }
  }

  // Validate types
  for (const [name, value] of Object.entries(args)) {
    const propSchema = properties[name];
    if (!propSchema) continue;

    const typeError = validateType(name, value, propSchema);
    if (typeError) errors.push(typeError);
  }

  return { valid: errors.length === 0, errors };
}

function validateType(name: string, value: unknown, schema: Record<string, unknown>): string | null {
  const expectedType = schema.type as string | undefined;
  if (!expectedType) return null;

  switch (expectedType) {
    case 'string':
      if (typeof value !== 'string') return `Parameter '${name}' must be a string`;
      if (schema.enum && !(schema.enum as unknown[]).includes(value)) {
        return `Parameter '${name}' must be one of: ${(schema.enum as unknown[]).join(', ')}`;
      }
      break;
    case 'number':
    case 'integer':
      if (typeof value !== 'number') return `Parameter '${name}' must be a number`;
      if (expectedType === 'integer' && !Number.isInteger(value)) {
        return `Parameter '${name}' must be an integer`;
      }
      if (schema.minimum !== undefined && value < (schema.minimum as number)) {
        return `Parameter '${name}' must be >= ${schema.minimum}`;
      }
      if (schema.maximum !== undefined && value > (schema.maximum as number)) {
        return `Parameter '${name}' must be <= ${schema.maximum}`;
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') return `Parameter '${name}' must be a boolean`;
      break;
    case 'array':
      if (!Array.isArray(value)) return `Parameter '${name}' must be an array`;
      break;
    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return `Parameter '${name}' must be an object`;
      }
      break;
  }

  return null;
}
