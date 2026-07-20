/**
 * sendTelegramMessage(text, opts)
 *
 * Posts a message to a Telegram bot channel.
 * Uses injected fetch and botConfig for testability.
 * All error codes are fixed strings — token, URL, chat ID, and external
 * response bodies never appear in thrown errors.
 *
 * @param {string}   text             - Message text (HTML parse mode by default)
 * @param {object}   opts
 * @param {Function} opts.fetch       - fetch implementation (injectable for tests)
 * @param {object}   opts.botConfig   - { token, chatId, parseMode? }
 * @returns {Promise<void>}
 *
 * Error codes: CONFIG_ERROR, SEND_FAILED, HTTP_ERROR, PARSE_ERROR
 */
export async function sendTelegramMessage(text, {
  fetch: fetchImpl = globalThis.fetch,
  botConfig,
} = {}) {
  if (!botConfig?.token) throw new Error('CONFIG_ERROR');
  if (!botConfig?.chatId) throw new Error('CONFIG_ERROR');

  // URL is never included in any thrown error.
  const url = `https://api.telegram.org/bot${botConfig.token}/sendMessage`;

  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: botConfig.chatId,
        text,
        parse_mode: botConfig.parseMode ?? 'HTML',
      }),
    });
  } catch {
    // Network error — do not re-throw original error (it may contain the URL).
    throw new Error('SEND_FAILED');
  }

  if (!res.ok) throw new Error('HTTP_ERROR');

  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error('PARSE_ERROR');
  }

  // Telegram API returns ok:false with a description field on failure.
  // Never include description in the thrown error.
  if (!body.ok) throw new Error('SEND_FAILED');
}
