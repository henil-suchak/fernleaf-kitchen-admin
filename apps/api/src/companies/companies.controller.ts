import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { PaginatedResponse } from '@fernleaf/contracts';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { PermissionCode } from '../authorization/permission-code';
import { CompanyService } from './company.service';
import { CompanyAddressDto } from './dto/company-address.dto';
import { CompanyListQueryDto } from './dto/company-list-query.dto';
import { CreateCompanyDto } from './dto/create-company.dto';
import { CreateCompanyHolidayDto } from './dto/create-company-holiday.dto';
import { ReplaceCompanyDomainsDto } from './dto/replace-company-domains.dto';
import { UpdateCompanyAddressDto } from './dto/update-company-address.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import type {
  CompanyAddressResponse,
  CompanyHolidayResponse,
  CompanyResponse,
  CompanySummaryResponse,
} from './company.types';

@Controller('companies')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CompaniesController {
  constructor(private readonly companyService: CompanyService) {}

  @Get()
  @RequirePermissions(PermissionCode.COMPANY_READ)
  listCompanies(
    @Query() query: CompanyListQueryDto,
  ): Promise<PaginatedResponse<CompanySummaryResponse>> {
    return this.companyService.listCompanies(query);
  }

  @Post()
  @RequirePermissions(PermissionCode.COMPANY_WRITE)
  createCompany(@Body() input: CreateCompanyDto): Promise<CompanyResponse> {
    return this.companyService.createCompany(input);
  }

  @Patch(':id')
  @RequirePermissions(PermissionCode.COMPANY_WRITE)
  updateCompany(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateCompanyDto,
  ): Promise<CompanyResponse> {
    return this.companyService.updateCompany(id, input);
  }

  @Put(':id/domains')
  @RequirePermissions(PermissionCode.COMPANY_WRITE)
  replaceDomains(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: ReplaceCompanyDomainsDto,
  ): Promise<CompanyResponse> {
    return this.companyService.replaceDomains(id, input);
  }

  @Post(':id/addresses')
  @RequirePermissions(PermissionCode.COMPANY_WRITE)
  addAddress(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: CompanyAddressDto,
  ): Promise<CompanyAddressResponse> {
    return this.companyService.addAddress(id, input);
  }

  @Patch(':id/addresses/:addressId')
  @RequirePermissions(PermissionCode.COMPANY_WRITE)
  updateAddress(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('addressId', new ParseUUIDPipe({ version: '4' })) addressId: string,
    @Body() input: UpdateCompanyAddressDto,
  ): Promise<CompanyAddressResponse> {
    return this.companyService.updateAddress(id, addressId, input);
  }

  @Get(':id/holidays')
  @RequirePermissions(PermissionCode.COMPANY_READ)
  listHolidays(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<CompanyHolidayResponse[]> {
    return this.companyService.listHolidays(id);
  }

  @Post(':id/holidays')
  @RequirePermissions(PermissionCode.COMPANY_WRITE)
  addHoliday(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: CreateCompanyHolidayDto,
  ): Promise<CompanyHolidayResponse> {
    return this.companyService.addHoliday(id, input);
  }

  @Delete(':id/holidays/:holidayId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PermissionCode.COMPANY_WRITE)
  async removeHoliday(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('holidayId', new ParseUUIDPipe({ version: '4' })) holidayId: string,
  ): Promise<void> {
    await this.companyService.removeHoliday(id, holidayId);
  }

  @Get(':id')
  @RequirePermissions(PermissionCode.COMPANY_READ)
  getCompany(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<CompanyResponse> {
    return this.companyService.getCompany(id);
  }
}
