import { QueueOptions } from "bullmq"

export const queueConfig: QueueOptions["connection"] = {
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT || ""),
  db: parseInt(process.env.REDIS_DB || "0"),
  password: process.env.REDIS_PASSWORD,
  commandTimeout: 10000,
  connectTimeout: 10000,
}