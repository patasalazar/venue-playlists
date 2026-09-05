const fetch = require('node-fetch');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { artists, playlistName } = JSON.parse(event.body);
    
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    const userId = process.env.SPOTIFY_USER_ID;

    if (!clientId || !clientSecret || !userId) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Spotify credentials not configured' })
      };
    }

    // Get access token
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Create playlist
    const playlistResponse = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: playlistName,
        description: 'Created with hear them live',
        public: false
      })
    });

    const playlistData = await playlistResponse.json();
    const playlistId = playlistData.id;

    // Search for artists and add tracks
    const trackUris = [];
    for (const artist of artists) {
      const searchResponse = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(artist)}&type=artist&limit=1&market=GB`,
        {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }
      );
      
      const searchData = await searchResponse.json();
      if (searchData.artists.items.length > 0) {
        const artistId = searchData.artists.items[0].id;
        
        // Get top tracks for this artist
        const tracksResponse = await fetch(
          `https://api.spotify.com/v1/artists/${artistId}/top_tracks?market=GB&limit=2`,
          {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          }
        );
        
        const tracksData = await tracksResponse.json();
        tracksData.tracks.forEach(track => trackUris.push(track.uri));
      }
    }

    // Shuffle and add to playlist
    const shuffledUris = trackUris.sort(() => Math.random() - 0.5);
    
    if (shuffledUris.length > 0) {
      await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ uris: shuffledUris.slice(0, 100) })
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ playlistUrl: `https://open.spotify.com/playlist/${playlistId}` })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
