import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PortalAuthGuard } from '../portal-auth/portal-auth.guard';
import { PortalAdminNavService } from './portal-admin-nav.service';

@ApiTags('Portal Admin')
@Controller('portal-admin')
@UseGuards(PortalAuthGuard)
export class PortalAdminNavController {
  constructor(private readonly portalAdminNavService: PortalAdminNavService) {}

  @Get('nav-badges')
  @ApiOperation({
    summary: 'Sidebar badge counts (support, comments, reports) in one request',
  })
  navBadges() {
    return this.portalAdminNavService.getNavBadges();
  }
}
