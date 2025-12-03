const key = 'AIzaSyCTXqzxp5oRPoW745dHZjGDQ2yFOd4fvDQ';
const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;

fetch(url)
  .then(res => res.json())
  .then(data => {
    if (data.models) {
      console.log('Available models:');
      data.models.forEach(m => console.log(`- ${m.name} (${m.displayName})`));
    } else {
      console.log('Error:', JSON.stringify(data, null, 2));
    }
  })
  .catch(err => console.error(err));

