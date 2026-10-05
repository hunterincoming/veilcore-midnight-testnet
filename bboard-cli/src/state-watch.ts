// SPDX-License-Identifier: Apache-2.0
/**
 * The main menu's view of "your record" (option 31), kept up to date from the indexer.
 *
 * The stream ends with an error when the indexer's websocket drops or a private-state
 * read fails. Subscribed without an error handler, rxjs rethrows that error on a timer
 * and Node exits, mid-rotation if that is what was happening (round D, D-8). Here an
 * error clears what option 31 shows, says so once, and the stream is subscribed again
 * after a growing pause (5 s, then up to a minute).
 */
import { type Observable, type Subscription, retry, timer } from 'rxjs';
import { type Logger } from 'pino';

export const watchState = <S>(
  state$: Observable<S>,
  logger: Pick<Logger, 'warn' | 'info'>,
  onState: (s: S | undefined) => void,
  baseDelayMs = 5_000,
): Subscription => {
  let failing = false;
  return state$
    .pipe(
      retry({
        delay: (e: unknown, attempt: number) => {
          onState(undefined);
          if (!failing) {
            failing = true;
            logger.warn(
              `Updates from the indexer stopped (${e instanceof Error ? e.message : String(e)}). ` +
                'Retrying; until then option 31 has nothing to show.',
            );
          }
          return timer(Math.min(baseDelayMs * attempt, 60_000));
        },
      }),
    )
    .subscribe({
      next: (s) => {
        if (failing) logger.info('Updates from the indexer are back.');
        failing = false;
        onState(s);
      },
      error: (e: unknown) => {
        onState(undefined);
        logger.warn(`Updates from the indexer stopped (${e instanceof Error ? e.message : String(e)}).`);
      },
    });
};

/**
 * Last-resort handler for an error nothing else caught, while the CLI runs. It logs the
 * error instead of letting Node exit, and if a deploy or maintenance transaction was
 * under way, says to check whether it landed before repeating it. Returns the function
 * that removes it.
 */
export const guardProcess = (
  logError: (e: unknown) => void,
  logger: Pick<Logger, 'warn'>,
  transactionsInProgress: () => number,
): (() => void) => {
  const onError = (e: unknown): void => {
    logError(e);
    if (transactionsInProgress() > 0)
      logger.warn(
        'A transaction was in progress. Check whether it landed (option 30 or 31, or a block explorer) before repeating it.',
      );
  };
  process.on('uncaughtException', onError);
  process.on('unhandledRejection', onError);
  return () => {
    process.off('uncaughtException', onError);
    process.off('unhandledRejection', onError);
  };
};
