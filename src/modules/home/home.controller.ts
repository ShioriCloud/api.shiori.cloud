import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HomeService } from './home.service';

@ApiTags('Home')
@Controller('home')
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  @Get('custom-blocks')
  @Header('Cache-Control', 'private, no-cache, no-store, must-revalidate')
  @ApiOperation({ summary: 'Resolved custom home blocks for mini-app' })
  getCustomBlocks() {
    return this.homeService.getCustomBlocks();
  }
}
