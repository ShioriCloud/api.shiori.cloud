import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PortalAuthGuard } from '../portal-auth/portal-auth.guard';
import { PortalFullAdminGuard } from '../portal-auth/portal-full-admin.guard';
import {
  CreateSponsorCampaignDto,
  ToggleSponsorCampaignDto,
  UpdateSponsorCampaignDto,
} from '../sponsor-campaigns/sponsor-campaigns.dto';
import { SponsorCampaignsService } from '../sponsor-campaigns/sponsor-campaigns.service';

@ApiTags('Membership Admin')
@Controller('membership-admin')
@UseGuards(PortalAuthGuard, PortalFullAdminGuard)
export class MembershipAdminController {
  constructor(private readonly sponsorCampaigns: SponsorCampaignsService) {}

  @Get('campaigns')
  @ApiOperation({ summary: 'List sponsor campaigns' })
  listCampaigns() {
    return this.sponsorCampaigns.listCampaigns();
  }

  @Get('campaigns/:id')
  @ApiOperation({ summary: 'Get one sponsor campaign' })
  getCampaign(@Param('id', ParseUUIDPipe) id: string) {
    return this.sponsorCampaigns.getCampaign(id);
  }

  @Get('campaigns/:id/stats')
  @ApiOperation({ summary: 'Campaign join stats' })
  getCampaignStats(@Param('id', ParseUUIDPipe) id: string) {
    return this.sponsorCampaigns.getCampaignStats(id);
  }

  @Post('campaigns')
  @ApiOperation({ summary: 'Create sponsor campaign' })
  createCampaign(@Body() body: CreateSponsorCampaignDto) {
    return this.sponsorCampaigns.createCampaign(body);
  }

  @Patch('campaigns/:id')
  @ApiOperation({ summary: 'Update sponsor campaign' })
  updateCampaign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateSponsorCampaignDto,
  ) {
    return this.sponsorCampaigns.updateCampaign(id, body);
  }

  @Patch('campaigns/:id/toggle')
  @ApiOperation({ summary: 'Toggle sponsor campaign active state' })
  toggleCampaign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ToggleSponsorCampaignDto,
  ) {
    return this.sponsorCampaigns.toggleCampaign(id, body);
  }

  @Delete('campaigns/:id')
  @ApiOperation({ summary: 'Delete sponsor campaign' })
  deleteCampaign(@Param('id', ParseUUIDPipe) id: string) {
    return this.sponsorCampaigns.deleteCampaign(id);
  }
}
