// Run this in browser console to force clear all cached data and reload

// Clear all localStorage
localStorage.clear();

// Clear all sessionStorage  
sessionStorage.clear();

// Clear IndexedDB (if used)
if (window.indexedDB) {
  indexedDB.databases().then(databases => {
    databases.forEach(db => {
      indexedDB.deleteDatabase(db.name);
    });
  });
}

// Force hard reload
console.log('Cache cleared! Performing hard reload...');
setTimeout(() => {
  window.location.reload(true);
}, 1000);
