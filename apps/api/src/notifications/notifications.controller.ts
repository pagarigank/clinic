import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { ModuleAllowlist } from '../rbac/module.guard.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import {
  CreateNotificationSchema,
  NotificationPreferencesSchema,
  type CreateNotificationRequest,
  type NotificationPreferencesRequest,
} from '@clinic/contracts';
import { NotificationsService } from './notifications.service.js';
import type { FastifyRequest } from 'fastify';
import type { RequestWithAuth } from '../auth/auth-context.js';
import { ProblemException } from '../http/problem.exception.js';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller()
@UseGuards(AuthGuard)
@ModuleAllowlist()
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get(['notifications', 'me/notifications'])
  @ApiOperation({ summary: 'List in-app notifications for current user' })
  async listNotifications(
    @Req() req: FastifyRequest & RequestWithAuth,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const auth = req.authContext;
    if (!auth?.tenantId || !auth?.userId) {
      throw new ProblemException('TENANT_CONTEXT_MISSING', { detail: 'Authenticated user and tenant required' });
    }

    return this.notificationsService.listNotifications(auth.tenantId, auth.userId, {
      unreadOnly: unreadOnly === 'true',
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Post(['notifications/:id/read', 'me/notifications/:id/read'])
  @ApiOperation({ summary: 'Mark an in-app notification as read' })
  async markAsRead(
    @Req() req: FastifyRequest & RequestWithAuth,
    @Param('id') id: string,
  ) {
    const auth = req.authContext;
    if (!auth?.tenantId || !auth?.userId) {
      throw new ProblemException('TENANT_CONTEXT_MISSING', { detail: 'Authenticated user and tenant required' });
    }

    return this.notificationsService.markAsRead(auth.tenantId, auth.userId, id);
  }

  @Post(['notifications/read-all', 'me/notifications/read-all'])
  @ApiOperation({ summary: 'Mark all unread in-app notifications as read' })
  async markAllAsRead(@Req() req: FastifyRequest & RequestWithAuth) {
    const auth = req.authContext;
    if (!auth?.tenantId || !auth?.userId) {
      throw new ProblemException('TENANT_CONTEXT_MISSING', { detail: 'Authenticated user and tenant required' });
    }

    return this.notificationsService.markAllAsRead(auth.tenantId, auth.userId);
  }

  @Get('me/preferences')
  @ApiOperation({ summary: 'Get current user notification preferences and quiet hours' })
  async getPreferences(@Req() req: FastifyRequest & RequestWithAuth) {
    const auth = req.authContext;
    if (!auth?.tenantId || !auth?.userId) {
      throw new ProblemException('TENANT_CONTEXT_MISSING', { detail: 'Authenticated user and tenant required' });
    }

    return this.notificationsService.getPreferences(auth.tenantId, auth.userId);
  }

  @Put('me/preferences')
  @ApiOperation({ summary: 'Update user notification preferences and quiet hours' })
  async updatePreferencesPut(
    @Req() req: FastifyRequest & RequestWithAuth,
    @Body(new ZodValidationPipe(NotificationPreferencesSchema)) body: NotificationPreferencesRequest,
  ) {
    const auth = req.authContext;
    if (!auth?.tenantId || !auth?.userId) {
      throw new ProblemException('TENANT_CONTEXT_MISSING', { detail: 'Authenticated user and tenant required' });
    }

    return this.notificationsService.updatePreferences(auth.tenantId, auth.userId, body);
  }

  @Patch('me/preferences')
  @ApiOperation({ summary: 'Patch user notification preferences and quiet hours' })
  async updatePreferencesPatch(
    @Req() req: FastifyRequest & RequestWithAuth,
    @Body(new ZodValidationPipe(NotificationPreferencesSchema)) body: NotificationPreferencesRequest,
  ) {
    const auth = req.authContext;
    if (!auth?.tenantId || !auth?.userId) {
      throw new ProblemException('TENANT_CONTEXT_MISSING', { detail: 'Authenticated user and tenant required' });
    }

    return this.notificationsService.updatePreferences(auth.tenantId, auth.userId, body);
  }

  @Post('notifications')
  @ApiOperation({ summary: 'Create an in-app notification' })
  async createNotification(
    @Req() req: FastifyRequest & RequestWithAuth,
    @Body(new ZodValidationPipe(CreateNotificationSchema)) body: CreateNotificationRequest,
  ) {
    const auth = req.authContext;
    if (!auth?.tenantId || !auth?.userId) {
      throw new ProblemException('TENANT_CONTEXT_MISSING', { detail: 'Authenticated user and tenant required' });
    }

    return this.notificationsService.createNotification(auth.tenantId, auth.userId, body);
  }
}
