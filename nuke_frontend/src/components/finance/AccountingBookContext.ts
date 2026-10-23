import { createContext, useContext } from 'react';
export const AccountingBookContext = createContext<{ ownerId?: string; shared: boolean; canCorrect?: boolean; liveRevision?: string }>({ shared: false });
export const useAccountingBook = () => useContext(AccountingBookContext);
