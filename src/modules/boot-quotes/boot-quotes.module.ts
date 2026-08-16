import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BootQuote } from '../../entities/boot-quote.entity';
import { BootQuotesController } from './boot-quotes.controller';
import { BootQuotesService } from './boot-quotes.service';

@Module({
  imports: [TypeOrmModule.forFeature([BootQuote])],
  controllers: [BootQuotesController],
  providers: [BootQuotesService],
})
export class BootQuotesModule {}
