import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../prisma/prisma.service';
import type { LoginDto } from './dto/login.dto';
import type { AuthenticatedStaff } from './types/authenticated-staff.type';

interface LoginResult {
  token: string;
  cookieMaxAge: number;
  user: AuthenticatedStaff;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(loginDto: LoginDto): Promise<LoginResult> {
    const email = normalizeEmail(loginDto.email);
    const staffUser = await this.prisma.staffUser.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        isActive: true,
        role: {
          select: {
            code: true,
            name: true,
          },
        },
      },
    });

    if (!staffUser || !staffUser.isActive) {
      throw invalidCredentials();
    }

    const passwordMatches = await bcrypt.compare(
      loginDto.password,
      staffUser.passwordHash,
    );

    if (!passwordMatches) {
      throw invalidCredentials();
    }

    const sessionDuration = parseSessionDuration(
      this.config.getOrThrow<string>('JWT_EXPIRES_IN'),
    );
    const token = await this.jwtService.signAsync(
      { sub: staffUser.id },
      { expiresIn: sessionDuration.seconds },
    );

    return {
      token,
      cookieMaxAge: sessionDuration.milliseconds,
      user: toAuthenticatedStaff(staffUser),
    };
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function invalidCredentials(): UnauthorizedException {
  return new UnauthorizedException('Invalid email or password');
}

function parseSessionDuration(value: string): {
  seconds: number;
  milliseconds: number;
} {
  const match = /^(\d+)([smhd])$/.exec(value);

  if (!match) {
    throw new Error('JWT_EXPIRES_IN must use s, m, h, or d units, such as 8h.');
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const secondsPerUnit = { s: 1, m: 60, h: 60 * 60, d: 24 * 60 * 60 };
  const seconds = amount * secondsPerUnit[unit as keyof typeof secondsPerUnit];

  return { seconds, milliseconds: seconds * 1000 };
}

function toAuthenticatedStaff(staffUser: {
  id: string;
  email: string;
  role: { code: string; name: string };
}): AuthenticatedStaff {
  return {
    id: staffUser.id,
    email: staffUser.email,
    role: staffUser.role,
  };
}
