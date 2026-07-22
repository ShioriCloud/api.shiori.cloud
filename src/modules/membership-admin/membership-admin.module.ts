import { Module } from '@nestjs/common';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { SponsorCampaignsModule } from '../sponsor-campaigns/sponsor-campaigns.module';
import { MembershipAdminController } from './membership-admin.controller';

@Module({
  imports: [PortalAuthModule, SponsorCampaignsModule],
  controllers: [MembershipAdminController],
})
export class MembershipAdminModule {}
