import type { ConfigService } from '@nestjs/config';

type Environment = Record<string, string | undefined>;

export function validateEnvironment(environment: Environment): Environment {
  const nodeEnv = environment.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production.');
  }

  const databaseUrl = required(environment, 'DATABASE_URL');
  validateDatabaseUrl(databaseUrl);

  const frontendUrl = environment.FRONTEND_URL ?? (nodeEnv === 'production' ? undefined : 'http://localhost:3000');
  const frontendOrigins = parseFrontendOrigins(
    requiredValue(frontendUrl, 'FRONTEND_URL'),
    nodeEnv === 'production',
  );

  const jwtSecret = required(environment, 'JWT_SECRET');
  if (jwtSecret.startsWith('replace-with-') || jwtSecret.length < (nodeEnv === 'production' ? 32 : 16)) {
    throw new Error('JWT_SECRET must be a non-placeholder secret of at least 32 characters in production.');
  }

  const jwtExpiresIn = required(environment, 'JWT_EXPIRES_IN');
  if (!/^[1-9]\d*[smhd]$/.test(jwtExpiresIn)) {
    throw new Error('JWT_EXPIRES_IN must use a positive s, m, h, or d duration, such as 8h.');
  }

  const port = environment.PORT ?? '3001';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535.');
  }

  return {
    ...environment,
    NODE_ENV: nodeEnv,
    DATABASE_URL: databaseUrl,
    FRONTEND_URL: frontendOrigins.join(','),
    JWT_SECRET: jwtSecret,
    JWT_EXPIRES_IN: jwtExpiresIn,
    PORT: port,
  };
}

export function getFrontendOrigins(config: ConfigService): Set<string> {
  return new Set(parseFrontendOrigins(config.getOrThrow<string>('FRONTEND_URL')));
}

function required(environment: Environment, name: string): string {
  return requiredValue(environment[name], name);
}

function requiredValue(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${name} must be configured.`);
  }
  return trimmed;
}

function validateDatabaseUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }

  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error('DATABASE_URL must use the postgresql protocol.');
  }
}

function parseFrontendOrigins(value: string, requireHttps = false): string[] {
  const origins = value.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (!origins.length) {
    throw new Error('FRONTEND_URL must include at least one browser origin.');
  }

  return origins.map((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error('FRONTEND_URL must contain valid http or https origins.');
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== value) {
      throw new Error('FRONTEND_URL values must be exact http or https origins without a path.');
    }
    if (requireHttps && url.protocol !== 'https:') {
      throw new Error('FRONTEND_URL must use https in production.');
    }
    return url.origin;
  });
}
