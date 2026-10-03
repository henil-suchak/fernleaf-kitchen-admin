import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Res,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

import { AuthService } from './auth.service';
import { CurrentStaff } from './decorators/current-staff.decorator';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard, SESSION_COOKIE_NAME } from './guards/jwt-auth.guard';
import type { AuthenticatedStaff } from './types/authenticated-staff.type';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: AuthenticatedStaff }> {
    const result = await this.authService.login(loginDto);

    response.cookie(SESSION_COOKIE_NAME, result.token, {
      ...this.cookieOptions(),
      maxAge: result.cookieMaxAge,
    });

    return { user: result.user };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getCurrentStaff(
    @CurrentStaff() staffUser: AuthenticatedStaff,
  ): { user: AuthenticatedStaff } {
    return { user: staffUser };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) response: Response): { success: true } {
    response.clearCookie(SESSION_COOKIE_NAME, this.cookieOptions());

    return { success: true };
  }

  private cookieOptions(): {
    httpOnly: true;
    secure: boolean;
    sameSite: 'lax';
    path: '/';
  } {
    return {
      httpOnly: true,
      secure: this.config.get<string>('NODE_ENV') === 'production',
      sameSite: 'lax',
      path: '/',
    };
  }
}
