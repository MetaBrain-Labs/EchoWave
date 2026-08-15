/** Validates process configuration before the HTTP server starts. */
import { readFileSync } from "node:fs";

import { parse } from "dotenv";
import { z } from "zod";

const BooleanStringSchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const EnvironmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535),
  CORS_ORIGINS: z.string().min(1),
  POSTGRES_HOST: z.string().min(1),
  POSTGRES_PORT: z.coerce.number().int().min(1).max(65_535),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string(),
  POSTGRES_DB: z.string().min(1),
  POSTGRES_SCHEMA: z.string().min(1),
  POSTGRES_SSL: BooleanStringSchema,
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().min(1).max(65_535),
  REDIS_PASSWORD: z.string(),
  REDIS_USERNAME: z.string(),
  REDIS_DB: z.coerce.number().int().min(0),
  REDIS_TLS: BooleanStringSchema,
});

export type ApiConfig = {
  port: number;
  corsOrigins: string[];
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    schema: string;
    ssl: boolean;
  };
  redis: {
    host: string;
    port: number;
    password: string;
    username: string;
    database: number;
    tls: boolean;
  };
};

export function readApiConfig(values: Record<string, string | undefined>): ApiConfig {
  const parsed = EnvironmentSchema.parse(values);
  const corsOrigins = parsed.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (corsOrigins.length === 0) {
    throw new Error("CORS_ORIGINS must contain at least one origin.");
  }

  return {
    port: parsed.PORT,
    corsOrigins,
    database: {
      host: parsed.POSTGRES_HOST,
      port: parsed.POSTGRES_PORT,
      user: parsed.POSTGRES_USER,
      password: parsed.POSTGRES_PASSWORD,
      database: parsed.POSTGRES_DB,
      schema: parsed.POSTGRES_SCHEMA,
      ssl: parsed.POSTGRES_SSL,
    },
    redis: {
      host: parsed.REDIS_HOST,
      port: parsed.REDIS_PORT,
      password: parsed.REDIS_PASSWORD,
      username: parsed.REDIS_USERNAME,
      database: parsed.REDIS_DB,
      tls: parsed.REDIS_TLS,
    },
  };
}

/** Loads the required API configuration exclusively from the given .env file. */
export function readApiConfigFile(fileUrl: URL): ApiConfig {
  try {
    return readApiConfig(parse(readFileSync(fileUrl)));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new Error(`Required API configuration file was not found: ${fileUrl.pathname}`, {
        cause: error,
      });
    }
    throw error;
  }
}
