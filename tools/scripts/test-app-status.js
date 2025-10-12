// Check if app is running
fetch('http://localhost:5174/')
  .then(res => res.text())
  .then(html => {
    if (html.includes('<div id="root">')) {
      console.log('✅ HTML is loading with root element');
    }
    if (html.includes('main.tsx')) {
      console.log('✅ main.tsx script is referenced');
    }
    console.log('\n📱 The app appears to be serving HTML. Check browser console for React mounting errors.');
    console.log('   If you see "[main] starting application bootstrap" in console, React is loading.');
    console.log('   If not, there may be TypeScript compilation errors blocking the app.\n');
  })
  .catch(err => {
    console.error('❌ Server not responding:', err.message);
  });
