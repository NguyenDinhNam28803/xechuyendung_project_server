import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Actor } from '../activity/activity.service.js';
import { AdminAuthGuard } from '../auth/admin-auth.guard.js';
import {
  type AdminPrincipal,
  CurrentActor,
  CurrentAdmin,
  Roles,
} from '../auth/admin-principal.js';
import { parsePaginationQuery } from '../common/pagination.js';
import { parseSort } from '../common/sorting.js';
import {
  adminUserDefaultOrder,
  adminUserSortColumns,
  AdminSessionsService,
  AdminUsersService,
} from './admin-users.service.js';
import {
  parseChangePassword,
  parseCreateAdminUser,
  parseUpdateAdminUser,
} from './admin-users.validation.js';

@Controller('api/v1/admin/users')
@UseGuards(AdminAuthGuard)
@Roles('admin')
export class AdminUsersController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly sessions: AdminSessionsService,
  ) {}

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') search?: string,
    @Query('sort') sort?: string,
  ) {
    return this.users.findAll(
      parsePaginationQuery(page, limit, search),
      parseSort(sort, adminUserSortColumns, adminUserDefaultOrder),
    );
  }

  @Post()
  create(@Body() body: unknown, @CurrentActor() actor: Actor) {
    return this.users.create(parseCreateAdminUser(body), actor);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: AdminPrincipal,
  ) {
    return this.users.update(id, parseUpdateAdminUser(body), admin);
  }

  /** Các thiết bị đang đăng nhập của một tài khoản. */
  @Get(':id/sessions')
  sessionsOf(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.sessions.listForUser(id);
  }

  /** Đăng xuất tài khoản khỏi mọi thiết bị. */
  @Post(':id/sessions/revoke')
  @HttpCode(200)
  revokeSessions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ) {
    return this.sessions.revokeAllForUser(id, admin);
  }
}

/** Thao tác trên chính tài khoản đang đăng nhập; mọi vai trò đều dùng được. */
@Controller('api/v1/admin/account')
@UseGuards(AdminAuthGuard)
export class AdminAccountController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly sessions: AdminSessionsService,
  ) {}

  @Post('password')
  @HttpCode(200)
  changePassword(@Body() body: unknown, @CurrentAdmin() admin: AdminPrincipal) {
    return this.users.changeOwnPassword(admin, parseChangePassword(body));
  }

  @Get('sessions')
  listSessions(@CurrentAdmin() admin: AdminPrincipal) {
    return this.sessions.listOwn(admin);
  }

  @Delete('sessions/:id')
  revokeSession(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ) {
    return this.sessions.revokeOwn(admin, id);
  }
}
