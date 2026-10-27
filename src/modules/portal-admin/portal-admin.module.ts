import { Module } from '@nestjs/common';
import { AnimeCommentsModule } from '../anime-comments/anime-comments.module';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { SupportTicketsModule } from '../support-tickets/support-tickets.module';
import { PortalAdminNavController } from './portal-admin-nav.controller';
import { PortalAdminNavService } from './portal-admin-nav.service';

@Module({
  imports: [PortalAuthModule, SupportTicketsModule, AnimeCommentsModule],
  controllers: [PortalAdminNavController],
  providers: [PortalAdminNavService],
})
export class PortalAdminModule {}
