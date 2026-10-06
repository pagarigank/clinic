/**
 * Tests for TemplatesService (todo 2.1)
 * - Template creation (draft v1)
 * - Versioning (v2 draft)
 * - Publish version (unpublishes prior versions)
 * - Preview version content
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { TemplatesService } from '../src/templates/templates.service.js';
import { probeDb } from '@clinic/db/tests/helpers.js';
import { createPool } from '@clinic/db';
import { seedUsers, NO_SEED_USERS } from "@clinic/db/tests/helpers.js";

const hasDb = await probeDb();

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const { USER_A } = hasDb ? await seedUsers() : NO_SEED_USERS;

describe.skipIf(!hasDb)('TemplatesService (todo 2.1)', () => {
  let service: TemplatesService;
  const createdTemplateIds: string[] = [];

  beforeEach(() => {
    service = new TemplatesService();
  });

  afterAll(async () => {
    if (createdTemplateIds.length > 0) {
      const ownerPool = createPool({ role: 'owner' });
      await ownerPool.query(`DELETE FROM template_versions WHERE template_id = ANY($1)`, [createdTemplateIds]);
      await ownerPool.query(`DELETE FROM templates WHERE id = ANY($1)`, [createdTemplateIds]);
    }
  });

  it('creates a template with version 1 in draft state', async () => {
    const code = `consent_${Date.now().toString().slice(-4)}`;
    const t = await service.createTemplate(TENANT_A, USER_A, {
      type: 'CONSENT',
      code,
      name: 'General Treatment Consent',
      content: 'I hereby consent to general medical examination and treatment.',
    });
    createdTemplateIds.push(t.id);

    expect(t.id).toBeDefined();
    expect(t.code).toBe(code);
    expect(t.version_number).toBe(1);
    expect(t.is_published).toBe(false);

    // List templates
    const list = await service.listTemplates(TENANT_A, USER_A, 'CONSENT');
    expect(list.data.some((row: any) => row.id === t.id)).toBe(true);
  });

  it('adds a new version, publishes it, and previews content', async () => {
    const code = `notif_${Date.now().toString().slice(-4)}`;
    const t = await service.createTemplate(TENANT_A, USER_A, {
      type: 'NOTIFICATION',
      code,
      name: 'Appointment Reminder',
      content: 'Reminder: Your appointment is tomorrow.',
    });
    createdTemplateIds.push(t.id);

    // Add version 2
    const v2 = await service.addVersion(
      TENANT_A,
      USER_A,
      t.id,
      'Updated Reminder: Your appointment is tomorrow at {{time}}.',
    );
    expect(v2.version_number).toBe(2);
    expect(v2.is_published).toBe(false);

    // Publish version 2
    const pub = await service.publishVersion(TENANT_A, USER_A, t.id, v2.id);
    expect(pub.published).toBe(true);

    // Preview version 2
    const preview = await service.previewVersion(TENANT_A, USER_A, t.id, v2.id);
    expect(preview.content).toContain('Updated Reminder');
    expect(preview.is_published).toBe(true);
  });
});
