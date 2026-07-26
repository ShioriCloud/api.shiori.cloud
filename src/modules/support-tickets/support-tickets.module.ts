import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupportTicket } from '../../entities/support-ticket.entity';
import { SupportTicketMessage } from '../../entities/support-ticket-message.entity';
import { TelegramUser } from '../../entities/telegram-user.entity';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { SupportTicketsAdminController } from './support-tickets-admin.controller';
import { SupportTicketsController } from './support-tickets.controller';
import { SupportTicketsService } from './support-tickets.service';

@Module({
  imports: [
    PortalAuthModule,
    TypeOrmModule.forFeature([SupportTicket, SupportTicketMessage, TelegramUser]),
  ],
  controllers: [SupportTicketsController, SupportTicketsAdminController],
  providers: [SupportTicketsService],
})
export class SupportTicketsModule {}
