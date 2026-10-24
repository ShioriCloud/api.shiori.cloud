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
  CreateBootQuoteDto,
  ReorderBootQuotesDto,
  ToggleBootQuoteDto,
  UpdateBootQuoteDto,
} from './boot-quotes-admin.dto';
import { BootQuotesAdminService } from './boot-quotes-admin.service';

@ApiTags('Boot Quotes Admin')
@Controller('boot-quotes-admin')
@UseGuards(PortalAuthGuard)
export class BootQuotesAdminController {
  constructor(
    private readonly bootQuotesAdminService: BootQuotesAdminService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all boot splash quotes' })
  listQuotes() {
    return this.bootQuotesAdminService.listQuotes();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one boot splash quote' })
  getQuote(@Param('id', ParseUUIDPipe) id: string) {
    return this.bootQuotesAdminService.getQuote(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a boot splash quote' })
  createQuote(@Body() body: CreateBootQuoteDto) {
    return this.bootQuotesAdminService.createQuote(body);
  }

  @Patch('reorder')
  @ApiOperation({ summary: 'Reorder boot splash quotes' })
  reorderQuotes(@Body() body: ReorderBootQuotesDto) {
    return this.bootQuotesAdminService.reorderQuotes(body);
  }

  @Patch(':id/toggle')
  @ApiOperation({ summary: 'Enable or disable a boot splash quote' })
  toggleQuote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ToggleBootQuoteDto,
  ) {
    return this.bootQuotesAdminService.toggleQuote(id, body.is_active);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a boot splash quote' })
  updateQuote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateBootQuoteDto,
  ) {
    return this.bootQuotesAdminService.updateQuote(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a boot splash quote' })
  deleteQuote(@Param('id', ParseUUIDPipe) id: string) {
    return this.bootQuotesAdminService.deleteQuote(id);
  }
}
