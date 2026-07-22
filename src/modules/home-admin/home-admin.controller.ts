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
import {
  CreateHomeBlockDto,
  ReorderHomeBlocksDto,
  ToggleHomeBlockDto,
  UpdateHomeBlockDto,
} from './home-admin.dto';
import { HomeAdminService } from './home-admin.service';

@ApiTags('Home Admin')
@Controller('home-admin')
@UseGuards(PortalAuthGuard)
export class HomeAdminController {
  constructor(private readonly homeAdminService: HomeAdminService) {}

  @Get('blocks')
  @ApiOperation({ summary: 'List all home blocks' })
  listBlocks() {
    return this.homeAdminService.listBlocks();
  }

  @Get('blocks/:id')
  @ApiOperation({ summary: 'Get one home block' })
  getBlock(@Param('id', ParseUUIDPipe) id: string) {
    return this.homeAdminService.getBlock(id);
  }

  @Post('blocks')
  @ApiOperation({ summary: 'Create a home block' })
  createBlock(@Body() body: CreateHomeBlockDto) {
    return this.homeAdminService.createBlock(body);
  }

  @Patch('blocks/reorder')
  @ApiOperation({ summary: 'Reorder home blocks' })
  reorderBlocks(@Body() body: ReorderHomeBlocksDto) {
    return this.homeAdminService.reorderBlocks(body);
  }

  @Patch('blocks/:id/toggle')
  @ApiOperation({ summary: 'Enable or disable a home block' })
  toggleBlock(@Param('id', ParseUUIDPipe) id: string, @Body() body: ToggleHomeBlockDto) {
    return this.homeAdminService.toggleBlock(id, body.is_active);
  }

  @Patch('blocks/:id')
  @ApiOperation({ summary: 'Update a home block' })
  updateBlock(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateHomeBlockDto) {
    return this.homeAdminService.updateBlock(id, body);
  }

  @Delete('blocks/:id')
  @ApiOperation({ summary: 'Delete a home block' })
  deleteBlock(@Param('id', ParseUUIDPipe) id: string) {
    return this.homeAdminService.deleteBlock(id);
  }
}
