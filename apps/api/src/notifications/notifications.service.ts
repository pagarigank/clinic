import { Injectable } from '@nestjs/common';
import { withTenant } from '@clinic/db';
import { ProblemException } from '../http/problem.exception.js';
import type {
  CreateNotificationRequest,
  NotificationPreferencesRequest,
} from '@clinic/contracts';

@Injectable()
export class NotificationsService {
  /**
   * List notifications for a specific user within the tenant.
   */
  async listNotifications(
    tenantId: string,
    userId: string,
    options?: { unreadOnly?: boolean; limit?: number; offset?: number },
  ) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const limit = options?.limit ?? 50;
      const offset = options?.offset ?? 0;
      const unreadFilter = options?.unreadOnly ? 'AND read_at IS NULL' : '';

      const itemsRes = await tx.query(
        `SELECT id, tenant_id, user_id, title, body, severity, entity_type, entity_id, deep_link, read_at, created_at
         FROM user_notifications
         WHERE tenant_id = $1 AND user_id = $2 ${unreadFilter}
         ORDER BY created_at DESC
         LIMIT $3 OFFSET $4`,
        [tenantId, userId, limit, offset],
      );

      const unreadRes = await tx.query<{ count: string }>(
        `SELECT count(*) as count
         FROM user_notifications
         WHERE tenant_id = $1 AND user_id = $2 AND read_at IS NULL`,
        [tenantId, userId],
      );

      return {
        data: itemsRes.rows,
        meta: {
          unreadCount: parseInt(unreadRes.rows[0]?.count ?? '0', 10),
          limit,
          offset,
        },
      };
    });
  }

  /**
   * Mark a single notification as read.
   */
  async markAsRead(tenantId: string, userId: string, notifId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `UPDATE user_notifications
         SET read_at = now()
         WHERE id = $1 AND tenant_id = $2 AND user_id = $3
         RETURNING id, read_at`,
        [notifId, tenantId, userId],
      );

      if ((res.rowCount ?? 0) === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'Notification not found' });
      }

      return res.rows[0];
    });
  }

  /**
   * Mark all unread notifications as read for the user.
   */
  async markAllAsRead(tenantId: string, userId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `UPDATE user_notifications
         SET read_at = now()
         WHERE tenant_id = $1 AND user_id = $2 AND read_at IS NULL
         RETURNING id`,
        [tenantId, userId],
      );

      return { markedCount: res.rowCount ?? 0 };
    });
  }

  /**
   * Get user notification preferences.
   */
  async getPreferences(tenantId: string, userId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `SELECT id, channels, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, updated_at
         FROM user_notification_preferences
         WHERE tenant_id = $1 AND user_id = $2`,
        [tenantId, userId],
      );

      if ((res.rowCount ?? 0) === 0) {
        // Return default preferences
        return {
          channels: { in_app: true, email: true, sms: false },
          quiet_hours_enabled: false,
          quiet_hours_start: '22:00:00',
          quiet_hours_end: '07:00:00',
        };
      }

      return res.rows[0];
    });
  }

  /**
   * Update user notification preferences (channels, quiet hours).
   */
  async updatePreferences(
    tenantId: string,
    userId: string,
    dto: NotificationPreferencesRequest,
  ) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const channelsJson = JSON.stringify(dto.channels || { in_app: true, email: true, sms: false });
      const quietEnabled = dto.quietHoursEnabled ?? false;
      const qStart = dto.quietHoursStart || '22:00:00';
      const qEnd = dto.quietHoursEnd || '07:00:00';

      const res = await tx.query(
        `INSERT INTO user_notification_preferences (
           tenant_id, user_id, channels, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, updated_at
         )
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, now())
         ON CONFLICT (tenant_id, user_id)
         DO UPDATE SET
           channels = EXCLUDED.channels,
           quiet_hours_enabled = EXCLUDED.quiet_hours_enabled,
           quiet_hours_start = EXCLUDED.quiet_hours_start,
           quiet_hours_end = EXCLUDED.quiet_hours_end,
           updated_at = now()
         RETURNING id, channels, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, updated_at`,
        [tenantId, userId, channelsJson, quietEnabled, qStart, qEnd],
      );

      return res.rows[0];
    });
  }

  /**
   * Create an in-app notification for a user.
   */
  async createNotification(
    tenantId: string,
    userId: string,
    dto: CreateNotificationRequest,
  ) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO user_notifications (
           tenant_id, user_id, title, body, severity, entity_type, entity_id, deep_link
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, tenant_id, user_id, title, body, severity, entity_type, entity_id, deep_link, created_at`,
        [
          tenantId,
          dto.userId,
          dto.title,
          dto.body,
          dto.severity || 'INFO',
          dto.entityType || null,
          dto.entityId || null,
          dto.deepLink || null,
        ],
      );

      return res.rows[0];
    });
  }
}
