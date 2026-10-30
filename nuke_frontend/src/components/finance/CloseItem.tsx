import type { ReactNode } from 'react';
import { Text } from '../../kit/Text';

/** The two list parts every row of the books docket is made of: a row in the year card's list, and the line a read shows while it waits or after it failed. */
export function Item({ children, amount, onClick, warn }: { children: ReactNode; amount?: ReactNode; onClick?: () => void; warn?: boolean }) {
  const body = <><span className="accounting-close-item__main">{children}</span>
    {amount !== undefined && <Text role="measure" className="accounting-close-item__amount">{amount}</Text>}
    {onClick && <span aria-hidden="true">›</span>}</>;
  return <li className="accounting-close-item" data-warn={warn ? 'true' : undefined}>
    {onClick ? <button type="button" className="accounting-close-item__button" onClick={onClick}>{body}</button> : <div className="accounting-close-item__button">{body}</div>}
  </li>;
}

/** A read in flight says so; a read that failed says so with a retry. It never shows zero. */
export function Waiting({ what, failed, onRetry }: { what: string; failed: boolean; onRetry: () => void }) {
  return failed
    ? <li className="accounting-close-item"><div className="accounting-close-item__button" role="alert"><span className="accounting-close-item__main"><Text role="body">{what} could not load.</Text></span><button type="button" onClick={onRetry}>Try again</button></div></li>
    : <li className="accounting-close-item"><div className="accounting-close-item__button" role="status"><span className="accounting-close-item__main"><Text role="caption">Reading {what.charAt(0).toLowerCase()}{what.slice(1)}…</Text></span></div></li>;
}
