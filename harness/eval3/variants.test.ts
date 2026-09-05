import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { HESITATE_DESCRIPTION, hesitateInput } from '../../src/mcp.js';
import { doofToolsFor } from './variants.js';

describe('eval 3 frozen tool variants', () => {
  it('keeps the v1 schema independent of the production schema', () => {
    const hesitate = doofToolsFor('A0').find((tool) => tool.name === 'hesitate');
    expect(hesitate?.input_schema.properties?.what?.description).toBe('What you are about to do. One or two sentences.');
    expect(hesitate?.input_schema.properties?.why?.description).toBe(
      'Why you think it may exceed what was intended: the instruction, the ambiguity, the input you doubt.',
    );
  });

  it('keeps A4 identical to the current production hesitate definition', () => {
    const hesitate = doofToolsFor('A4').find((tool) => tool.name === 'hesitate');
    const production = z.toJSONSchema(hesitateInput);
    expect(hesitate?.description).toBe(HESITATE_DESCRIPTION);
    expect(hesitate?.input_schema.properties).toEqual(production.properties);
  });
});
