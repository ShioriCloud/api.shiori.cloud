import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SponsorCampaign, SponsorJoinEvent } from '../../entities';
import { SponsorCampaignsService } from './sponsor-campaigns.service';

@Module({
  imports: [TypeOrmModule.forFeature([SponsorCampaign, SponsorJoinEvent])],
  providers: [SponsorCampaignsService],
  exports: [SponsorCampaignsService],
})
export class SponsorCampaignsModule {}
