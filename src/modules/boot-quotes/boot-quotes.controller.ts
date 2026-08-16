import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BootQuotesService } from './boot-quotes.service';

@ApiTags('Boot Quotes')
@Controller('boot-quotes')
export class BootQuotesController {
  constructor(private readonly bootQuotesService: BootQuotesService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'Active boot splash quotes for mini-app' })
  listActive() {
    return this.bootQuotesService.listActive();
  }
}
