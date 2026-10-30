import type { ReactNode } from 'react';
import { Text } from '../../kit/Text';

/** The year card of the accounting office and its list: the one renderer of the shape, used by Finish your taxes, the books docket and its large sums.
 *  Colour is a tone (good, bad, warn) chosen by the caller from its own state; the style sheet knows three tones and nothing else. */
export type Tone = 'good' | 'bad' | 'warn';

/** A row in a year card's list: the words on the left, an optional amount, an optional action beside the amount (a button of its own), a chevron when the
 *  whole row opens something, and an optional panel below the row (an open form). A row that opens something is one button; a row that does not is a div. */
export function CloseItem({ children, amount, onClick, action, below, tone, className }: {
  children: ReactNode; amount?: ReactNode; onClick?: () => void; action?: ReactNode; below?: ReactNode; tone?: Tone; className?: string;
}) {
  const body = <><span className="accounting-close-item__main">{children}</span>
    {amount !== undefined && <Text role="measure" className="accounting-close-item__amount">{amount}</Text>}
    {action}
    {onClick && <span aria-hidden="true">›</span>}</>;
  return <li className={className ? `accounting-close-item ${className}` : 'accounting-close-item'} data-tone={tone}>
    {onClick ? <button type="button" className="accounting-close-item__button" onClick={onClick}>{body}</button> : <div className="accounting-close-item__button">{body}</div>}
    {below}
  </li>;
}

/** One tax year: the card, its head, and the list of rows beneath (and anything that follows the list, such as a fold of settled facts). */
export function CloseYear({ id, label, className, tone, head, children, after }: {
  id: string; label: string; className?: string; tone?: Tone; head: ReactNode; children: ReactNode; after?: ReactNode;
}) {
  return <article className={className ? `accounting-close-year ${className}` : 'accounting-close-year'} id={id} aria-label={label} data-tone={tone}>
    <header className="accounting-close-year__head">{head}</header>
    <ol className="accounting-close-list">{children}</ol>
    {after}
  </article>;
}

const lowerFirst = (text: string) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

/** A read in flight says so; a read that failed says so with a retry. It never shows zero. As a row of a card's list. */
export function Waiting({ what, failed, onRetry }: { what: string; failed: boolean; onRetry: () => void }) {
  return failed
    ? <li className="accounting-close-item"><div className="accounting-close-item__button" role="alert"><span className="accounting-close-item__main"><Text role="body">{what} could not load.</Text></span><button type="button" onClick={onRetry}>Try again</button></div></li>
    : <li className="accounting-close-item"><div className="accounting-close-item__button" role="status"><span className="accounting-close-item__main"><Text role="caption">Reading {lowerFirst(what)}…</Text></span></div></li>;
}

/** The same two states for a whole section: the line a page shows while its first read is in flight, and the one it shows when that read failed. */
export function ReadState({ what, failed, onRetry }: { what: string; failed: boolean; onRetry: () => void }) {
  return failed
    ? <p role="alert"><Text role="body">{what} could not load.</Text> <button type="button" onClick={onRetry}>Try again</button></p>
    : <p role="status"><Text role="caption">Reading {lowerFirst(what)}…</Text></p>;
}
