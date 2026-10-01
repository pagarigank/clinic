import { Injectable } from '@nestjs/common';
import { withTenant } from '@clinic/db';
import { ProblemException } from '../http/problem.exception.js';
import type { CreateTemplateRequest } from '@clinic/contracts';

@Injectable()
export class TemplatesService {
  async listTemplates(tenantId: string, userId: string, type?: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const params: unknown[] = [];
      let where = '';
      if (type) { params.push(type); where = `AND t.type = $${params.length}`; }
      const res = await tx.query(
        `SELECT t.id, t.type, t.code, t.name, t.created_at,
                (SELECT json_agg(json_build_object('id', tv.id, 'versionNumber', tv.version_number, 'isPublished', tv.is_published, 'createdAt', tv.created_at) ORDER BY tv.version_number DESC)
                 FROM template_versions tv WHERE tv.template_id = t.id) AS versions
         FROM templates t WHERE true ${where} ORDER BY t.type, t.name`,
        params,
      );
      return { data: res.rows };
    });
  }

  async createTemplate(tenantId: string, userId: string, dto: CreateTemplateRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const tmplRes = await tx.query(
        `INSERT INTO templates (tenant_id, type, code, name) VALUES ($1, $2, $3, $4) RETURNING id`,
        [tenantId, dto.type, dto.code, dto.name],
      );
      const templateId = tmplRes.rows[0].id;
      const verRes = await tx.query(
        `INSERT INTO template_versions (tenant_id, template_id, version_number, content, is_published)
         VALUES ($1, $2, 1, $3, false) RETURNING id, version_number, is_published`,
        [tenantId, templateId, dto.content],
      );
      return { templateId, ...verRes.rows[0] };
    });
  }

  async addVersion(tenantId: string, userId: string, templateId: string, content: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const maxRes = await tx.query(
        `SELECT COALESCE(MAX(version_number), 0) AS max_ver FROM template_versions WHERE template_id = $1`,
        [templateId],
      );
      const nextVer = (maxRes.rows[0].max_ver as number) + 1;
      const res = await tx.query(
        `INSERT INTO template_versions (tenant_id, template_id, version_number, content, is_published)
         VALUES ($1, $2, $3, $4, false) RETURNING id, version_number, is_published`,
        [tenantId, templateId, nextVer, content],
      );
      return res.rows[0];
    });
  }

  async publishVersion(tenantId: string, userId: string, templateId: string, versionId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      // Unpublish all other versions of this template
      await tx.query(`UPDATE template_versions SET is_published = false WHERE template_id = $1`, [templateId]);
      const res = await tx.query(
        `UPDATE template_versions SET is_published = true WHERE id = $1 AND template_id = $2 RETURNING id, version_number, is_published`,
        [versionId, templateId],
      );
      if ((res.rowCount ?? 0) === 0) throw new ProblemException('NOT_FOUND', { detail: 'Version not found' });
      return res.rows[0];
    });
  }

  async previewVersion(tenantId: string, userId: string, templateId: string, versionId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `SELECT tv.content, tv.version_number, t.type, t.name
         FROM template_versions tv JOIN templates t ON t.id = tv.template_id
         WHERE tv.id = $1 AND tv.template_id = $2`,
        [versionId, templateId],
      );
      if ((res.rowCount ?? 0) === 0) throw new ProblemException('NOT_FOUND', { detail: 'Version not found' });
      return res.rows[0];
    });
  }
}
