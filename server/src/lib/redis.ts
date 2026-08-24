import IORedis from "ioredis";
import { env } from "../config/env";

// BullMQ requires maxRetriesPerRequest: null on any connection given to a
// Worker (it manages its own retry policy for blocking reads); a Queue can
// safely share the same connection.
export const redis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});
