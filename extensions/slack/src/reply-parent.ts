import type { WebClient } from "@slack/web-api";
import { PlatformMessageNotDispatchedError } from "openclaw/plugin-sdk/error-runtime";
import { withSlackDnsRequestRetry } from "./client-delivery.js";
import { getSlackWebApiErrorData } from "./errors.js";

async function hasLiveReplyParent(
  client: WebClient,
  channel: string,
  ts: string,
): Promise<boolean> {
  const readMessage = async (timestamp: string) => {
    const response = await withSlackDnsRequestRetry("conversations.history", () =>
      client.conversations.history({
        channel,
        oldest: timestamp,
        latest: timestamp,
        inclusive: true,
        limit: 1,
      }),
    );
    if (!response.ok) {
      throw new Error(response.error ?? "Slack parent lookup failed");
    }
    return response.messages?.find((message) => message.ts === timestamp);
  };
  const isLive = (message: { ts?: string; subtype?: string } | undefined) =>
    Boolean(
      message?.ts && message.subtype !== "tombstone" && message.subtype !== "message_deleted",
    );
  const message = await readMessage(ts);
  if (message) {
    return (
      isLive(message) &&
      (!message.thread_ts ||
        message.thread_ts === ts ||
        isLive(await readMessage(message.thread_ts)))
    );
  }
  // Slack also accepts a child timestamp. Children are absent from channel
  // history; resolve its root, then require that root to still exist.
  const replies = await withSlackDnsRequestRetry("conversations.replies", () =>
    client.conversations.replies({ channel, ts, limit: 1 }),
  ).catch((error: unknown) => {
    if (getSlackWebApiErrorData(error)?.error === "thread_not_found") {
      return undefined;
    }
    throw error;
  });
  if (!replies || replies.error === "thread_not_found") {
    return false;
  }
  if (!replies.ok) {
    throw new Error(replies.error ?? "Slack parent lookup failed");
  }
  const parent = replies.messages?.[0];
  const rootTs = parent?.thread_ts ?? parent?.ts;
  return Boolean(rootTs && rootTs !== ts && isLive(parent) && isLive(await readMessage(rootTs)));
}

export async function assertSlackReplyParent(
  clients: readonly WebClient[],
  channelId: string,
  threadTs: string,
): Promise<void> {
  let lookupError: unknown;
  for (const client of clients) {
    try {
      if (await hasLiveReplyParent(client, channelId, threadTs)) {
        return;
      }
    } catch (error) {
      lookupError = error;
    }
  }
  if (lookupError) {
    throw new PlatformMessageNotDispatchedError(
      "Could not verify Slack reply parent; message not sent. Do not resend at channel top level.",
      { cause: lookupError },
    );
  }
  throw new PlatformMessageNotDispatchedError(
    "Slack reply parent is missing or deleted; message not sent. Do not resend at channel top level.",
    { cause: undefined, retryable: false },
  );
}
