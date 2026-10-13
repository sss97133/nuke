import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Masthead, Text } from '../kit';
import { usePageTitle } from '../hooks/usePageTitle';
import './NotFound.css';

/**
 * A path with no page. Until now the router sent every unknown address to the market page without a word, so a
 * visitor with a stale or mistyped link landed on the board believing it was the page they asked for.
 */
const NotFound: React.FC = () => {
  usePageTitle('No such page');
  const { pathname } = useLocation();
  return (
    <main className="not-found" aria-label="No such page">
      <Masthead result={<Text role="caption">no page at this address</Text>}>
        <Text role="entity" as="h1">No such page</Text>
      </Masthead>
      <section className="k-section not-found__body">
        <Text role="body" as="p">The ledger has no page at <Text role="caption" className="not-found__path">{pathname}</Text>. The link may be old, or mistyped.</Text>
        <Text role="body" as="p">
          <Link to="/?tab=market">The live board</Link> · <Link to="/search">Search</Link> · <Link to="/journal">The journal</Link> · <Link to="/about">About</Link>
        </Text>
      </section>
    </main>
  );
};

export default NotFound;
