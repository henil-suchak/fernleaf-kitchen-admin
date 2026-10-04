import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../prisma/prisma.service';
import type { CreateStaffDto } from './dto/create-staff.dto';
import type { UpdateStaffDto } from './dto/update-staff.dto';

const staffSelect = Prisma.validator<Prisma.StaffUserSelect>()({
  id: true,
  email: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { id: true, code: true, name: true } },
});

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  async listStaff() {
    return this.prisma.staffUser.findMany({
      orderBy: [{ email: 'asc' }, { id: 'asc' }],
      select: staffSelect,
    });
  }

  async listRoles() {
    return this.prisma.role.findMany({
      orderBy: [{ name: 'asc' }, { code: 'asc' }],
      select: { id: true, code: true, name: true },
    });
  }

  async createStaff(input: CreateStaffDto) {
    const email = input.email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(input.password, 12);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await requireRole(transaction, input.roleId);
        return transaction.staffUser.create({
          data: { email, passwordHash, roleId: input.roleId },
          select: staffSelect,
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A Staff User already exists with this email.');
      }
      throw error;
    }
  }

  async updateStaff(id: string, input: UpdateStaffDto) {
    if (input.roleId === undefined && input.isActive === undefined) {
      throw new BadRequestException('At least one Staff User field must be provided.');
    }

    return this.serializable(async (transaction) => {
      const current = await transaction.staffUser.findUnique({
        where: { id },
        select: { id: true, isActive: true, role: { select: { code: true } } },
      });
      if (!current) {
        throw new NotFoundException('Staff User not found.');
      }

      const role = input.roleId === undefined
        ? current.role
        : await requireRole(transaction, input.roleId);
      const isActive = input.isActive ?? current.isActive;

      if (current.isActive && current.role.code === 'ADMIN' && (!isActive || role.code !== 'ADMIN')) {
        const activeAdminCount = await transaction.staffUser.count({
          where: { isActive: true, role: { code: 'ADMIN' } },
        });
        if (activeAdminCount <= 1) {
          throw new ConflictException('At least one active Administrator must remain.');
        }
      }

      return transaction.staffUser.update({
        where: { id },
        data: {
          ...(input.roleId === undefined ? {} : { roleId: input.roleId }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        },
        select: staffSelect,
      });
    });
  }

  private async serializable<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 2) {
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Staff User update conflicted with another request.');
  }
}

async function requireRole(transaction: Prisma.TransactionClient, roleId: string) {
  const role = await transaction.role.findUnique({
    where: { id: roleId },
    select: { id: true, code: true, name: true },
  });
  if (!role) {
    throw new NotFoundException('Role not found.');
  }
  return role;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
